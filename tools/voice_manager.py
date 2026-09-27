import os
import struct
import subprocess
import threading
import time
import requests

PARSER_VERSION = 4

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACB_DIR = os.path.join(BASE_DIR, 'game res', 'audio', 'acb')
AWB_DIR = os.path.join(BASE_DIR, 'game res', 'audio', 'awb')
# v4 maps the Waveform row to its real StreamAwbId before selecting an AWB
# subsong. This especially matters for cv000000, whose waveform rows are not
# stored in AWB id order.
VOICE_JP_DIR = os.path.join(BASE_DIR, 'game res', 'audio', 'voice_jp_v4')
VOICE_EN_DIR = os.path.join(BASE_DIR, 'game res', 'audio', 'voice_en')
VGMSTREAM_EXE = os.path.join(BASE_DIR, 'tools', 'vgmstream', 'vgmstream-cli.exe')

os.makedirs(VOICE_JP_DIR, exist_ok=True)
os.makedirs(VOICE_EN_DIR, exist_ok=True)

_JP_MAP = None
_lock = threading.Lock()
_bank_locks = {pkg: threading.Lock() for pkg in ('cv000000', 'cv001000', 'cv005000')}
_retry_after = {}

def _ensure_bank_file(pkg, extension):
    """Fetch only the required JP bank, streaming to disk with an atomic rename."""
    folder = ACB_DIR if extension == 'acb' else AWB_DIR
    target = os.path.join(folder, f'{pkg}_jp.{extension}')
    with _bank_locks[pkg]:
        if os.path.isfile(target) and os.path.getsize(target) > 32:
            return target
        if time.monotonic() < _retry_after.get(target, 0):
            return None
        os.makedirs(folder, exist_ok=True)
        temp = target + '.download'
        try:
            url = f'https://cdn.dokkan-eclipse.com/uncompressed/voice/{pkg}/{pkg}.{extension}'
            with requests.get(url, stream=True, timeout=(10, 30)) as response:
                response.raise_for_status()
                with open(temp, 'wb') as output:
                    for chunk in response.iter_content(256 * 1024):
                        output.write(chunk)
                expected = int(response.headers.get('Content-Length') or 0)
                if expected and os.path.getsize(temp) != expected:
                    raise ValueError('Incomplete voice bank')
            with open(temp, 'rb') as source:
                if source.read(4) != (b'@UTF' if extension == 'acb' else b'AFS2'):
                    raise ValueError('Invalid voice bank')
            os.replace(temp, target)
            return target
        except (requests.RequestException, OSError, ValueError) as exc:
            _retry_after[target] = time.monotonic() + 30
            print(f'JP voice bank {pkg}: {exc}')
            return None
        finally:
            if os.path.exists(temp):
                os.remove(temp)

_UTF_SIZES = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 8, 7: 8, 8: 4, 9: 8, 10: 4, 11: 8}

def _utf_value(data, pos, value_type, strings_base, data_base):
    if value_type in (0, 1): return data[pos], pos + 1
    if value_type in (2, 3): return struct.unpack_from('>H', data, pos)[0], pos + 2
    if value_type in (4, 5, 8): return struct.unpack_from('>I', data, pos)[0], pos + 4
    if value_type in (6, 7, 9): return struct.unpack_from('>Q', data, pos)[0], pos + 8
    if value_type == 10:
        off = struct.unpack_from('>I', data, pos)[0]
        end = data.find(b'\x00', strings_base + off)
        return data[strings_base + off:end].decode('utf-8', errors='ignore'), pos + 4
    if value_type == 11:
        off, size = struct.unpack_from('>II', data, pos)
        return data[data_base + off:data_base + off + size], pos + 8
    return None, pos + _UTF_SIZES.get(value_type, 0)

def _find_utf_table(data, wanted_name):
    """Read the named CRI @UTF table, including per-row blob columns."""
    scan = 0
    while True:
        base = data.find(b'@UTF', scan)
        if base < 0: return []
        try:
            # CRI UTF stores an unknown/version u16 at +8 and the row offset
            # as u16 at +10 (not one u32). Reading both as u32 points far past
            # nested ACB tables and yields an empty cue map.
            rows_base = base + 8 + struct.unpack_from('>H', data, base + 10)[0]
            strings_base = base + 8 + struct.unpack_from('>I', data, base + 12)[0]
            data_base = base + 8 + struct.unpack_from('>I', data, base + 16)[0]
            name_off = struct.unpack_from('>I', data, base + 20)[0]
            name_end = data.find(b'\x00', strings_base + name_off)
            name = data[strings_base + name_off:name_end].decode('utf-8', errors='ignore')
            col_count = struct.unpack_from('>H', data, base + 24)[0]
            row_width = struct.unpack_from('>H', data, base + 26)[0]
            row_count = struct.unpack_from('>I', data, base + 28)[0]
            schema_pos = base + 32
            columns = []
            for _ in range(col_count):
                flags = data[schema_pos]
                schema_pos += 1
                col_name_off = struct.unpack_from('>I', data, schema_pos)[0]
                schema_pos += 4
                col_end = data.find(b'\x00', strings_base + col_name_off)
                col_name = data[strings_base + col_name_off:col_end].decode('utf-8', errors='ignore')
                storage, value_type = flags & 0xF0, flags & 0x0F
                const = None
                if storage == 0x30:
                    const, schema_pos = _utf_value(data, schema_pos, value_type, strings_base, data_base)
                columns.append((col_name, storage, value_type, const))
            if name == wanted_name:
                rows = []
                for row_no in range(row_count):
                    pos = rows_base + row_no * row_width
                    row = {}
                    for col_name, storage, value_type, const in columns:
                        if storage == 0x30:
                            row[col_name] = const
                        elif storage == 0x50:
                            row[col_name], pos = _utf_value(data, pos, value_type, strings_base, data_base)
                        elif storage == 0x10:
                            row[col_name] = 0
                    rows.append(row)
                return rows
        except Exception:
            pass
        scan = base + 4

def _parse_acb_cue_table(acb_path):
    if not os.path.exists(acb_path):
        return {}
    try:
        with open(acb_path, 'rb') as f:
            data = f.read()

        cue_rows = _find_utf_table(data, 'Cue')
        synth_rows = _find_utf_table(data, 'Synth')
        waveform_rows = _find_utf_table(data, 'Waveform')
        sequence_rows = _find_utf_table(data, 'Sequence')
        track_rows = _find_utf_table(data, 'Track')
        event_rows = _find_utf_table(data, 'TrackEvent')

        def first_u16(blob):
            return struct.unpack_from('>H', blob, 0)[0] if blob and len(blob) >= 2 else None

        def waveform_from_synth(synth_idx):
            if not (0 <= synth_idx < len(synth_rows)):
                return None
            refs = synth_rows[synth_idx].get('ReferenceItems', b'') or b''
            for pos in range(0, len(refs) - 3, 4):
                item_type, item_idx = struct.unpack_from('>HH', refs, pos)
                if item_type == 1:
                    return item_idx
            return None

        def waveform_from_sequence(sequence_idx):
            if not (0 <= sequence_idx < len(sequence_rows)):
                return None
            track_idx = first_u16(sequence_rows[sequence_idx].get('TrackIndex', b''))
            if track_idx is None or not (0 <= track_idx < len(track_rows)):
                return None
            event_idx = int(track_rows[track_idx].get('EventIndex', -1))
            if not (0 <= event_idx < len(event_rows)):
                return None
            command = event_rows[event_idx].get('Command', b'') or b''
            pos = 0
            while pos + 3 <= len(command):
                opcode = struct.unpack_from('>H', command, pos)[0]
                size = command[pos + 2]
                payload = command[pos + 3:pos + 3 + size]
                if opcode == 0x07D0 and len(payload) >= 4:
                    ref_type, ref_idx = struct.unpack_from('>HH', payload, 0)
                    if ref_type == 1:
                        return ref_idx
                    if ref_type == 2:
                        return waveform_from_synth(ref_idx)
                pos += 3 + size
            return None

        cues = {}
        for cue in cue_rows:
            cid = cue.get('CueId')
            ref_type = int(cue.get('ReferenceType', 0) or 0)
            ref_idx = int(cue.get('ReferenceIndex', -1) or 0)
            wave_idx = None
            if ref_type == 1:
                wave_idx = ref_idx
            elif ref_type == 2:
                wave_idx = waveform_from_synth(ref_idx)
            elif ref_type == 3:
                wave_idx = waveform_from_sequence(ref_idx)
            if cid is not None and wave_idx is not None:
                if 0 <= wave_idx < len(waveform_rows):
                    awb_id = waveform_rows[wave_idx].get('StreamAwbId')
                    if awb_id is not None and int(awb_id) != 65535:
                        # AFS2 ids in these JP banks are sequential; vgmstream
                        # addresses them as one-based subsongs.
                        cues[int(cid)] = int(awb_id)
        return cues
    except Exception as e:
        print(f'Error parsing {acb_path}: {e}')
        return {}

def get_jp_cue_map():
    global _JP_MAP
    if _JP_MAP is not None:
        return _JP_MAP
    with _lock:
        if _JP_MAP is not None:
            return _JP_MAP
        mapping = {}
        complete = True
        for pkg in _bank_locks:
            acb_p = _ensure_bank_file(pkg, 'acb')
            if not acb_p:
                complete = False
                continue
            cues = _parse_acb_cue_table(acb_p)
            for cid, widx in cues.items():
                mapping[cid] = (pkg, widx)
        if complete:
            _JP_MAP = mapping
        return mapping

def extract_jp_voice(cue_id):
    try:
        cid = int(cue_id)
    except:
        return None
    out_wav = os.path.join(VOICE_JP_DIR, f'voice_{cid}.wav')
    if os.path.exists(out_wav) and os.path.getsize(out_wav) > 1000:
        return out_wav

    mapping = get_jp_cue_map()
    info = mapping.get(cid)
    if not info:
        return None

    pkg, wave_idx = info
    awb_path = _ensure_bank_file(pkg, 'awb')
    if not awb_path or not os.path.exists(VGMSTREAM_EXE):
        return None

    subsong = wave_idx + 1
    try:
        cmd = [VGMSTREAM_EXE, '-s', str(subsong), '-o', out_wav, awb_path]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
                       timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 1000:
            return out_wav
    except Exception as e:
        print(f'Failed to extract JP voice {cid}: {e}')
    return None

if __name__ == '__main__':
    m = get_jp_cue_map()
    print(f'Loaded {len(m)} JP voice mappings.')
    for test_cid in [419, 425, 835, 1218]:
        p = extract_jp_voice(test_cid)
        print(f'Cue {test_cid} -> {p}')
