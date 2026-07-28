# Lab results — proof, one folder per lab

`docs/results/<lab>/` holds the curated evidence for a lab's exit checklist: the
screenshots and the screencast a reviewer needs to believe the feature works,
referenced from that lab's pull-request description.

**Curated is the operative word.** The recorder in `demo/` writes a fresh video,
eight frames and a `summary.json` on every run, and `demo/recordings/` is
git-ignored for that reason — it is working output. Only the take that ends up in
a PR is promoted here, and re-recording **replaces** the file rather than adding a
second one: binaries live in git history forever.

Screenshots are downscaled to 1280 px wide before committing (`sips -Z 1280`); the
recorder captures at 2× for stills, which is more than a PR body needs.

Referencing these from a PR or issue body needs an absolute URL — GitHub only
resolves relative paths inside rendered `.md` files:

```
https://raw.githubusercontent.com/teplyakoff/dev-digest/<branch>/docs/results/<lab>/<file>
```
