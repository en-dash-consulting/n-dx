// A worker that dies after its test passes, for tests/unit/setup-exit-trace.test.js.
export default {
  test: {
    include: ["*.fixture.js"],
    setupFiles: ["../../setup-exit-trace.js"],
  },
};
