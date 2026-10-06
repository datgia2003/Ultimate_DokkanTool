import tempfile
import unittest
import zipfile
from pathlib import Path

from eclp_builder import build_patch_zip
from modules.core.lua_compat import normalize_transferred_lua, native_animation_bytes


LEGACY = '''-- Transmuted by Dokkan Patch Tool: test
setPhase(9)
do
  local __tl_effects, __tl_sounds, __tl_voices = {}, {}, {}
  local function __tl_drop() return 0 end
  local function __tl_timed_work(fn, frame, id, ...)
    if id ~= nil and id ~= 0 then return fn(frame, id, ...) end
    return 0
  end
  for _, id in ipairs(__tl_effects) do setEffAlphaKey(241, id, 0) end
end
-- setPhase(8)
local text = "setPhase(7)"
local long = [=[setPhase(6)]=]
'''


class NativeLuaTests(unittest.TestCase):
    def test_transfer_repairs_phase_handle_and_interpolated_cleanup(self):
        result = normalize_transferred_lua(LEGACY)
        self.assertIn('setPhase(0)', result)
        self.assertNotIn('\nsetPhase(9)', result)
        self.assertIn('return nil end', result)
        self.assertNotIn('id ~= 0', result)
        self.assertIn('__tl_hide_effect(241, id)', result)
        self.assertIn('setEffAlphaKey(frame - 1, id, alpha and alpha.value or 255)', result)
        for literal in ('-- setPhase(8)', '"setPhase(7)"', '[=[setPhase(6)]=]'):
            self.assertIn(literal, result)
        self.assertEqual(normalize_transferred_lua(result), result)

    def test_zip_repairs_old_transfers_without_mutating_imported_source(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'phase1.lua'
            source.write_text(LEGACY, encoding='utf-8')
            archive = Path(temp) / 'mod.zip'
            build_patch_zip(str(archive), [(str(source), 'lua/ab_script/passive_skill_effect/phase1.lua')])
            with zipfile.ZipFile(archive) as z:
                output = z.read('files/lua/ab_script/passive_skill_effect/phase1.lua').decode()
            self.assertIn('__tl_hide_effect(241, id)', output)
            self.assertIn('setPhase(0)', output)
            self.assertEqual(source.read_text(encoding='utf-8'), LEGACY)

    def test_stock_lua_and_binary_assets_are_unchanged(self):
        stock = b'setPhase(9); entryEffect(0, 3314, 0x100, -1, 0, 0, 0)'
        self.assertEqual(native_animation_bytes(stock, 'files/lua/ab_script/ab_sys/as0032.lua'), stock)
        self.assertEqual(native_animation_bytes(LEGACY.encode(), 'files/character/card/test.dat'), LEGACY.encode())
        nullify = native_animation_bytes(LEGACY.encode(), 'files/lua/ab_script/ab_sys/test.lua').decode()
        self.assertIn('setPhase(9)', nullify)


if __name__ == '__main__':
    unittest.main()
