---
"@n-dx/web": patch
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

The dashboard's add-change box shows a `+` for attaching images when the model `ndx work` runs takes images, with thumbnails below the box until you add.

Pick images with `+` or paste one into the box. PNG, JPEG, GIF and WebP up to 5 MB each are accepted, at most eight per change. Add creates the change first, then stores each image beside its `index.md` in the change's folder under `changes/`. The image moves with the change when it is placed or reparented. If an image cannot be stored, the change is still added and the box says which image failed.

`ndx work` lists a change's images in the agent's brief, under Attached Images, with their paths, so the agent opens them before starting. The `+` is offered for Claude, Codex and Gemini models. For a local model it is offered only when the model's name marks it as a vision model (for example `llava` or `qwen2.5vl`). It is offered only on v2 PRDs.
