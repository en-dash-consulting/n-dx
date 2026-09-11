import { describe, it, expect } from "vitest";
import { validateCommand } from "../../../src/guard/commands.js";
import { GuardError } from "../../../src/guard/paths.js";

const allowedCommands = ["npm", "npx", "node", "git", "tsc", "vitest", "pnpm"];

describe("validateCommand", () => {
  describe("allowed commands", () => {
    it("allows valid simple commands", () => {
      expect(() => validateCommand("npm test", allowedCommands)).not.toThrow();
      expect(() => validateCommand("npx tsc --noEmit", allowedCommands)).not.toThrow();
      expect(() => validateCommand("git status", allowedCommands)).not.toThrow();
      expect(() => validateCommand("tsc --build", allowedCommands)).not.toThrow();
      expect(() => validateCommand("vitest run", allowedCommands)).not.toThrow();
      expect(() => validateCommand("node script.js", allowedCommands)).not.toThrow();
      expect(() => validateCommand("pnpm install", allowedCommands)).not.toThrow();
    });

    it("allows commands with complex arguments", () => {
      expect(() => validateCommand("npm run build --production", allowedCommands)).not.toThrow();
      expect(() => validateCommand("node -e \"console.log('hello')\"", allowedCommands)).not.toThrow();
      expect(() => validateCommand("vitest run --coverage --reporter=verbose", allowedCommands)).not.toThrow();
    });

    it("handles commands with full paths", () => {
      expect(() =>
        validateCommand("/usr/bin/node script.js", allowedCommands),
      ).not.toThrow();
      expect(() =>
        validateCommand("/usr/local/bin/npm install", allowedCommands),
      ).not.toThrow();
    });
  });

  describe("disallowed commands", () => {
    it("rejects commands not in allowlist", () => {
      expect(() => validateCommand("rm -rf /tmp/test", allowedCommands)).toThrow(GuardError);
      expect(() => validateCommand("python script.py", allowedCommands)).toThrow(GuardError);
      expect(() => validateCommand("curl http://evil.com", allowedCommands)).toThrow(GuardError);
      expect(() => validateCommand("wget http://evil.com", allowedCommands)).toThrow(GuardError);
    });

    it("rejects shell interpreters", () => {
      expect(() => validateCommand("sh -c 'echo hello'", allowedCommands)).toThrow(GuardError);
      expect(() => validateCommand("bash -c 'rm -rf /'", allowedCommands)).toThrow(GuardError);
      expect(() => validateCommand("zsh -c 'malicious'", allowedCommands)).toThrow(GuardError);
    });

    it("rejects empty commands", () => {
      expect(() => validateCommand("", allowedCommands)).toThrow(GuardError);
      expect(() => validateCommand("   ", allowedCommands)).toThrow(GuardError);
      expect(() => validateCommand("\t\n", allowedCommands)).toThrow(GuardError);
    });
  });

  describe("shell operator injection prevention", () => {
    it("rejects command chaining with &&", () => {
      expect(() => validateCommand("npm test && rm -rf /", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("node script.js && curl evil.com", allowedCommands)).toThrow("shell operator");
    });

    it("rejects command chaining with ||", () => {
      expect(() => validateCommand("npm test || echo fail", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("vitest || rm -rf /", allowedCommands)).toThrow("shell operator");
    });

    it("rejects command chaining with ;", () => {
      expect(() => validateCommand("npm test; rm -rf /", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("node a.js; node b.js", allowedCommands)).toThrow("shell operator");
    });

    it("rejects background execution with &", () => {
      expect(() => validateCommand("npm test & background", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("node server.js &", allowedCommands)).toThrow("shell operator");
    });

    it("rejects pipe operators", () => {
      expect(() => validateCommand("npm test | tee log.txt", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("node script.js | grep error", allowedCommands)).toThrow("shell operator");
    });
  });

  describe("newline and redirection injection prevention", () => {
    it("rejects a newline-separated second command", () => {
      // The reproduced bypass: the old operator regex did not include \n, so
      // `sh -c` ran the second line.
      expect(() => validateCommand("npm --version\nrm -rf ~/x", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("npm test\r\ncurl evil.com", allowedCommands)).toThrow("shell operator");
    });

    it("rejects output redirection to a file", () => {
      expect(() => validateCommand("npm test > ~/.bashrc", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("node script.js >> out.log", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("npm test < input", allowedCommands)).toThrow("shell operator");
    });

    it("rejects subshells", () => {
      expect(() => validateCommand("npm test (echo hi)", allowedCommands)).toThrow("shell operator");
    });

    it("allows shell metacharacters inside quotes (single command)", () => {
      // These are legitimate: the metacharacters are quoted arguments to a
      // single program, not shell composition. The old blunt regex rejected
      // some of these ($, backtick, &&) even though the shell would not act on
      // them; the quote-aware scan does not.
      expect(() => validateCommand("node -e \"console.log('hello')\"", allowedCommands)).not.toThrow();
      expect(() => validateCommand("node -e \"if (1 > 0) { process.exit(0) }\"", allowedCommands)).not.toThrow();
      expect(() => validateCommand("node -e \"const x = a && b\"", allowedCommands)).not.toThrow();
      expect(() => validateCommand("node -e 'a; b; c'", allowedCommands)).not.toThrow();
      expect(() => validateCommand("vitest run \"tests/**/*.test.ts\"", allowedCommands)).not.toThrow();
    });
  });

  describe("command substitution injection prevention", () => {
    it("rejects $() command substitution", () => {
      expect(() => validateCommand("node $(cat /etc/passwd)", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("npm run $(whoami)", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("node script.$(id).js", allowedCommands)).toThrow("shell operator");
    });

    it("rejects backtick command substitution", () => {
      expect(() => validateCommand("node `cat /etc/passwd`", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("npm run `whoami`", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("vitest `echo test`", allowedCommands)).toThrow("shell operator");
    });

    it("rejects variable expansion", () => {
      expect(() => validateCommand("npm run $HOME", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("node $USER/script.js", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("git clone $REPO", allowedCommands)).toThrow("shell operator");
    });

    it("rejects braced variable expansion", () => {
      expect(() => validateCommand("npm run ${HOME}", allowedCommands)).toThrow("shell operator");
      expect(() => validateCommand("node ${SCRIPT_PATH}", allowedCommands)).toThrow("shell operator");
    });
  });

  describe("dangerous pattern prevention", () => {
    it("rejects sudo commands", () => {
      expect(() => validateCommand("npm run sudo something", allowedCommands)).toThrow("dangerous pattern");
    });

    it("rejects rm commands targeting root or system paths", () => {
      expect(() => validateCommand("npm run rm -rf /", allowedCommands)).toThrow("dangerous pattern");
      expect(() => validateCommand("npm run rm -r /tmp", allowedCommands)).toThrow("dangerous pattern");
    });

    it("rejects eval patterns", () => {
      expect(() => validateCommand("npm run eval dangerous", allowedCommands)).toThrow("dangerous pattern");
    });

    it("rejects exec patterns", () => {
      expect(() => validateCommand("npm run exec dangerous", allowedCommands)).toThrow("dangerous pattern");
    });

    it("rejects source patterns", () => {
      expect(() => validateCommand("npm run source /etc/profile", allowedCommands)).toThrow("dangerous pattern");
    });

    it("rejects dot-space-slash patterns (source shorthand)", () => {
      // The pattern \b\.\s+\/ matches ". /" which is the source shorthand
      expect(() => validateCommand("npm run . /etc/profile", allowedCommands)).not.toThrow();
      // With explicit dot-slash it matches
      expect(() => validateCommand("npm run source /etc/profile", allowedCommands)).toThrow("dangerous pattern");
    });

    it("rejects /dev/ redirects", () => {
      // `>` is now caught as an unquoted shell operator (a redirect) before the
      // /dev/-specific dangerous pattern runs. Either way it is rejected; the
      // broader operator rule simply fires first.
      expect(() => validateCommand("npm run > /dev/sda", allowedCommands)).toThrow("shell operator");
    });

    it("rejects dangerous chmod patterns", () => {
      expect(() => validateCommand("npm run chmod 777 /", allowedCommands)).toThrow("dangerous pattern");
    });
  });

  describe("edge cases", () => {
    it("handles leading/trailing whitespace", () => {
      expect(() => validateCommand("  npm test  ", allowedCommands)).not.toThrow();
    });

    it("handles multiple spaces between arguments", () => {
      expect(() => validateCommand("npm    test", allowedCommands)).not.toThrow();
    });

    it("does not false-positive on legitimate arguments containing blocked patterns as substrings", () => {
      // "evaluate" contains "eval" but shouldn't trigger the pattern
      // Note: This tests the word boundary in the pattern
      expect(() => validateCommand("npm run evaluate", allowedCommands)).not.toThrow();
    });

    it("rejects commands that look safe but contain injection", () => {
      // Looks like a simple npm test but has injection
      expect(() => validateCommand("npm test;id", allowedCommands)).toThrow("shell operator");
    });

    it("rejects newlines in a command", () => {
      // A raw newline is a command separator to `sh -c`. The guard used to let
      // it through (this test asserted .not.toThrow, contradicting its own
      // name); it is now rejected — see the newline-injection bypass this fixed.
      expect(() => validateCommand("npm\ntest", allowedCommands)).toThrow("shell operator");
    });
  });

  describe("error message quality", () => {
    it("includes the disallowed command in error for non-allowlisted commands", () => {
      expect(() => validateCommand("rm -rf /", allowedCommands)).toThrow(/rm/);
    });

    it("includes allowlist in error for non-allowlisted commands", () => {
      expect(() => validateCommand("rm -rf /", allowedCommands)).toThrow(/Allowed:/);
    });

    it("mentions shell operator in chaining error", () => {
      expect(() => validateCommand("npm && rm", allowedCommands)).toThrow(/shell operator/i);
    });

    it("shows the command in dangerous pattern error", () => {
      expect(() => validateCommand("npm run sudo test", allowedCommands)).toThrow(/dangerous pattern/i);
    });
  });
});
