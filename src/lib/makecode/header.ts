// Calliope mini v3 target. Any project we hand to makecode.calliope.cc in
// controller=2 mode must carry this header or the editor won't bind.
//
// The header shape is identical for every Calliope MakeCode host, so it lives
// in the connection widget now; this file stays as the import path the
// generator already uses.
export {
  CALLIOPE_TARGET,
  CALLIOPE_TARGET_VERSION,
  createCalliopeHeader,
  randomHeaderId,
} from '@calliope-edu/mini-connection-widget/makecode';
