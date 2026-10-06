"""Native-game compatibility fixes for transferred animation scripts.

Keep strings/comments and source resources intact. This is a small lexer, not
a Lua evaluator; only the known global battle phase calls are rewritten.
"""
import re

_LONG_STRING = re.compile(r'\[(=*)\[')

_LEGACY_TIMED_WORK = re.compile(
    r'local\s+function\s+__tl_timed_work\s*\(fn,\s*frame,\s*id,\s*\.\.\.\)\s*'
    r'if\s+id\s*~=\s*nil\s+then\s+return\s+fn\(frame,\s*id,\s*\.\.\.\)\s+end\s*return\s+0\s+end'
)
_NATIVE_TIMED_WORK = '''local __tl_alphas = {}
  local function __tl_timed_work(fn, frame, id, ...)
    if id ~= nil then
      if fn == setEffAlphaKey then
        local alpha = ...
        if __tl_alphas[id] == nil or frame >= __tl_alphas[id].frame then
          __tl_alphas[id] = { frame = frame, value = alpha }
        end
      end
      return fn(frame, id, ...)
    end
    return 0
  end
  local function __tl_hide_effect(frame, id)
    local alpha = __tl_alphas[id]
    if frame > 0 and (alpha == nil or alpha.frame < frame) then
      setEffAlphaKey(frame - 1, id, alpha and alpha.value or 255)
    end
    setEffAlphaKey(frame, id, 0)
    __tl_alphas[id] = { frame = frame, value = 0 }
  end'''


def _code_mask(source):
    result = list(source)
    index = 0
    while index < len(source):
        start = index
        comment = source.startswith('--', index)
        literal_start = index + 2 if comment else index
        long = _LONG_STRING.match(source, literal_start)
        if long:
            closing = ']' + long.group(1) + ']'
            end = source.find(closing, literal_start + len(long.group(0)))
            index = len(source) if end < 0 else end + len(closing)
        elif comment:
            end = source.find('\n', index)
            index = len(source) if end < 0 else end
        elif source[index] in ('"', "'"):
            quote = source[index]
            index += 1
            while index < len(source):
                if source[index] == '\\':
                    index += 2
                elif source[index] == quote:
                    index += 1
                    break
                else:
                    index += 1
        else:
            index += 1
            continue
        for offset in range(start, min(index, len(source))):
            if source[offset] not in '\r\n':
                result[offset] = ' '
    return ''.join(result)


def normalize_transferred_lua(source, phase=0):
    """Use the destination phase, including old Timeline helper output.

    Browser binders queue all phases together, whereas the game executes the
    destination battle phase. Never retain Nullify's phase 9 in an Active,
    Entrance, Super or Finish animation.
    """
    masked = _code_mask(source)
    edits = []
    phase_calls = re.finditer(r'(?<![\w.:])\b(setPhase|gotoPhase|skipFrame)\s*\(', masked) if phase is not None else ()
    for match in phase_calls:
        # A user-defined local API is not a host command.
        if re.search(r'\b(?:local\s+)?function\s*$', masked[:match.start()]):
            continue
        depth = 1
        begin = match.end()
        arguments = []
        for index in range(begin, len(masked)):
            char = masked[index]
            if char in '({[':
                depth += 1
            elif char in ')}]':
                depth -= 1
                if depth == 0:
                    arguments.append((begin, index))
                    break
            elif char == ',' and depth == 1:
                arguments.append((begin, index))
                begin = index + 1
        argument_index = 1 if match.group(1) == 'gotoPhase' else 0
        if len(arguments) > argument_index:
            start, end = arguments[argument_index]
            edits.append((start, end, str(int(phase))))

    # Repair the exact helper definitions emitted by older Timeline versions.
    # The dropped-call sentinel must not collide with a native work handle 0.
    for pattern, replacement in (
        (r'local\s+function\s+__tl_drop\s*\(\s*\)\s+return\s+0\s+end',
         'local function __tl_drop() return nil end'),
        (r'if\s+id\s*~=\s*nil\s+and\s+id\s*~=\s*0\s+then\s+return\s+fn\s*\(',
         'if id ~= nil then return fn('),
    ):
        for match in re.finditer(pattern, masked):
            edits.append((match.start(), match.end(), replacement))
    for start, end, replacement in sorted(edits, reverse=True):
        source = source[:start] + replacement + source[end:]
    # Older cleanup keys also interpolated alpha from clip IN all the way to
    # zero at OUT. Upgrade only the exact generated helper/loop shapes.
    masked = _code_mask(source)
    cleanup_edits = [(m.start(), m.end(), _NATIVE_TIMED_WORK) for m in _LEGACY_TIMED_WORK.finditer(masked)]
    if cleanup_edits:
        cleanup_loop = re.compile(r'for\s+_,\s*id\s+in\s+ipairs\(__tl_effects\)\s+do\s+setEffAlphaKey\(([^,\n]+),\s*id,\s*0\)\s+end')
        for match in cleanup_loop.finditer(masked):
            cleanup_edits.append((match.start(), match.end(),
                                  f'for _, id in ipairs(__tl_effects) do __tl_hide_effect({match.group(1)}, id) end'))
        for start, end, replacement in sorted(cleanup_edits, reverse=True):
            source = source[:start] + replacement + source[end:]
    prefix = f'-- Destination battle phase\nsetPhase({int(phase)});\n' if phase is not None else ''
    return source if prefix and source.startswith(prefix) else prefix + source


def native_animation_bytes(data, archive_path):
    """Repair legacy generated Lua on export, without editing imported assets."""
    if not archive_path.replace('\\', '/').startswith('files/lua/ab_script/') or not archive_path.endswith('.lua'):
        return data
    if b'local function __tl_drop' not in data and b'-- Transmuted by Dokkan Patch Tool:' not in data:
        return data
    try:
        source = data.decode('utf-8')
    except UnicodeDecodeError:
        return data
    folder = archive_path.replace('\\', '/').split('/')[3]
    phase = None
    if b'-- Transmuted by Dokkan Patch Tool:' in data and folder != 'custom_lua':
        phase = 9 if folder == 'ab_sys' else 0
    return normalize_transferred_lua(source, phase=phase).encode('utf-8')
