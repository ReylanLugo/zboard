/**
 * Budget for tests that drive the plugin through the engine (boot, /zboard, engine
 * events, mounted panes). The kit's default is 5000 ms; on a loaded machine these
 * multi-hook flows exceed it without any assertion being wrong. Pure tests keep 5 s.
 */
export const PLUGIN_TEST_TIMEOUT_MS = 20_000
