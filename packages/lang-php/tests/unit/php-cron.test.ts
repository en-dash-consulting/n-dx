import { describe, expect, it } from "vitest";
import { cronScriptFile, isCliCheck, isCrontabFile, parseCrontab } from "../../src/index.js";

describe("isCrontabFile", () => {
  it("knows crontab, *.cron and cron.d/ files", () => {
    expect(["crontab", "deploy/crontab", "app.cron", "etc/cron.d/app"].every(isCrontabFile)).toBe(true);
    expect(["crontab.php", "cron/cleanup.php", ".cron", "cron.d"].some(isCrontabFile)).toBe(false);
  });
});

describe("parseCrontab", () => {
  const scripts = (text: string) => parseCrontab("crontab", text).map((j) => `${j.line} [${j.schedule}] ${j.script}`);

  it("keeps the schedule as written and skips comments, environment lines and non-PHP jobs", () => {
    expect(
      scripts(["# comment", "SHELL=/bin/sh", "", "*/5  *  * * * php a.php", "@hourly /opt/php7.4 b.php", "0 0 * * * echo php"].join("\n")),
    ).toEqual(["4 [*/5  *  * * *] a.php", "5 [@hourly] b.php"]);
  });

  it("skips PHP CLI options, takes -f's value and quotes off", () => {
    expect(scripts("* * * * * php -q -d memory_limit=1G -c /etc/php.ini \"x y/run.php\" arg")).toEqual(["1 [* * * * *] x y/run.php"]);
    expect(scripts("* * * * * php -n -f jobs/a.php -- --flag")).toEqual(["1 [* * * * *] jobs/a.php"]);
  });

  it("reads each php invocation of a command, past a system crontab's user and shell operators", () => {
    expect(scripts("0 * * * * root cd /srv && php a.php; php-cli b.php | logger\r")).toEqual(["1 [0 * * * *] a.php", "1 [0 * * * *] b.php"]);
  });
});

describe("cronScriptFile", () => {
  const files = new Set(["cron/cleanup.php", "cleanup.php", "scripts/report.php"]);

  it("takes the longest trailing part of a deployed path that is a repository file", () => {
    expect(cronScriptFile("/var/www/app/cron/cleanup.php", files)).toBe("cron/cleanup.php");
    expect(cronScriptFile("./scripts/report.php", files)).toBe("scripts/report.php");
    expect(cronScriptFile("/srv/other.php", files)).toBeUndefined();
  });
});

describe("isCliCheck", () => {
  it("accepts PHP_SAPI or php_sapi_name() compared with 'cli', either side", () => {
    for (const text of ["PHP_SAPI === 'cli'", "PHP_SAPI !== \"cli\"", "'cli' == \\PHP_SAPI", "PHP_SAPI_NAME() != 'cli'", "\\php_sapi_name() <> 'cli'"]) {
      expect(isCliCheck(text), text).toBe(true);
    }
  });

  it("rejects other operands and operators", () => {
    for (const text of ["PHP_SAPI === 'cgi'", "PHP_SAPI . 'cli'", "$sapi === 'cli'"]) expect(isCliCheck(text), text).toBe(false);
  });
});
