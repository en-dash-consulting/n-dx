# Minimal example

`ndx-hello` adds an `ndx hello` command, plus a sidecar web app that the hub home and each project's dashboard link to.

## Files

```
ndx-hello/
  package.json
  bin/cli.js
  bin/serve.js
  schema/config.json
```

`package.json`:

```json
{
  "name": "ndx-hello",
  "version": "1.0.0",
  "type": "module",
  "ndx": {
    "extension": {
      "apiVersion": 1,
      "name": "hello",
      "displayName": "Hello",
      "ndxVersion": ">=0.10.0",
      "commands": [
        { "name": "hello", "bin": "bin/cli.js", "summary": "Greet, then show the project's PRD status" }
      ],
      "sidecar": { "bin": "bin/serve.js", "health": "/healthz" },
      "hub": { "label": "Hello", "description": "A page the hub serves for the hello extension" },
      "projectLinks": [{ "label": "Hello", "path": "/project/{projectId}" }],
      "configSchema": "schema/config.json"
    }
  }
}
```

`bin/cli.js` reads its config, then calls back into the same n-dx install:

```js
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const config = JSON.parse(readFileSync(process.env.NDX_EXTENSION_CONFIG, "utf-8"));
console.log(`${config.greeting ?? "Hello"} from n-dx ${process.env.NDX_VERSION}`);

// NDX_BIN is n-dx's cli.js; process.execPath is the Node n-dx runs on.
execFileSync(process.execPath, [process.env.NDX_BIN, "status", "."], { stdio: "inherit" });
```

`bin/serve.js` listens on the loopback `PORT` the hub picks:

```js
import { createServer } from "node:http";

const secret = process.env.NDX_SIDECAR_SECRET;
if (!secret) throw new Error("Expected a hub launch secret");
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));

createServer((req, res) => {
  if (req.headers["x-ndx-sidecar-secret"] !== secret) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  // The hub strips /x/hello from the path and says where it mounted the app.
  const base = req.headers["x-ndx-base-path"];
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`Mounted at ${base}; asked for ${req.url}\n`);
}).listen(Number(process.env.PORT), "127.0.0.1");
```

`schema/config.json`:

```json
{
  "type": "object",
  "properties": { "greeting": { "type": "string" } },
  "additionalProperties": false
}
```

## Develop it

1. Point discovery at the checkout. Add the directory to `extensions.paths` in `<ndx home>/config.json` (the home is `~/.ndx` unless `NDX_HOME` is set):

    ```json
    { "extensions": { "paths": ["/path/to/ndx-hello"] } }
    ```

2. Check it with `ndx extensions doctor`. The command prints one line per problem with its fix, and exits 1 if there is any problem.
3. Approve it with `ndx extensions enable hello`. Pass `--yes` to skip the prompt.
4. Run `ndx hello`. Set the greeting with `ndx config extensions.hello.greeting Hi` (or `--user` for every project).
5. Open the app: `ndx start .`, then `http://localhost:3117/x/hello/`. The hub home shows a Hello card, and the project's dashboard header shows a Hello link.

Editing `package.json`'s `ndx.extension` block or bumping `version` asks for approval again. Editing the scripts does not.

## Ship it

Publish the package to npm. Users install and approve it with:

```sh
ndx extensions add ndx-hello
ndx extensions enable hello
```

`add` installs into `<ndx home>/extensions` with `--ignore-scripts`, so no install script runs before the user approves the extension. A package that is not on a registry installs from a path, resolved against the directory `add` runs in: `ndx extensions add ./ndx-hello-1.0.0.tgz` or `ndx extensions add ../ndx-hello`. `add` takes no npm flags; set the registry and similar through npm's own config (`npm_config_registry`, or `<ndx home>/extensions/.npmrc`). A project can also list the package in its own `package.json`. n-dx then runs it only for that project, after an approval tied to that project's path.
