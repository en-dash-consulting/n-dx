# @n-dx/graview

Projects an n-dx project into [Graview](https://graview.dev): a typed context
graph of the product layer (areas, capabilities, constraints), the change
layer (changes, tasks, releases), the code (zones, components) and the work
(agent runs, commits), declared once in `n-dx.graview.json` and filled from
the rex tree, sourcevision's output and hench's run records.

```sh
ndx graview emit .            # writes document.json and snapshot.json under the layout's graview dir
ndx graview check .           # graview check on the emitted declaration
ndx graview describe .        # a text readout of the graph, or one place with --place <slug>
ndx graview serve .           # graview serve: the store over HTTP and its live WebSocket wire, for a Graview face to connect to
ndx graview mcp .             # graview mcp --read-only: search_graph, get_node, describe_place, …
ndx graview info .            # where the projection lands, which binary, and the hub's rex endpoint a face writes back through
```

Nothing here depends on `@graview/*`. The `graview` binary is resolved from
`graview.bin` in the project config, `NDX_GRAVIEW_BIN`, PATH, then
`npx -y graview@0.1.19`. Install it once with `npm i -g graview` to skip the
npx round-trip.

Config keys (`.ndx/config.json` or `.n-dx.json`):

| Key | Meaning |
|-----|---------|
| `graview.bin` | Path to the graview binary or its `cli.js`; a `.js` path runs under the current Node |
| `graview.includeFiles` | Project file nodes by default (same as `--files`) |
| `graview.app` | A product face built from the emitted document; unset, `@n-dx/graview-face` is found beside this package or in `node_modules`. `ndx graview serve` runs it on the fresh projection with `NDX_GRAVIEW_DIR` pointing at the files |
