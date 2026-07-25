# @chadonsom/topography-toggle

Shared topography toggle behavior used by sibling projects.

## Publish

```bash
npm login
npm run check
npm publish --access public
```

`npm run check` rebuilds `dist/browser.js` from `src/index.js`. Do not edit the dist file by hand.

## API

```js
import { bindTopographyToggle } from "@chadonsom/topography-toggle"

const dispose = bindTopographyToggle(document.querySelector(".editor"), {
  headingSelector: "h1, h2, h3, h4, h5, h6",
  stickyActiveAttr: "data-sticky-active",
  baseTopPx: 0,
  inputTarget: document.querySelector(".editor"),
})
```

### Options

- `headingSelector`: default `h1, h2, h3, h4, h5, h6`
- `stickyActiveAttr`: default `data-sticky-active`
- `baseTopPx`: default `0`
- `inputTarget`: optional event target for `input` listener

### Returns

- Cleanup function that removes listeners and disconnects observers.

## Consumers

- fieldnote: install with `npm install @chadonsom/topography-toggle` and import from package root.
- blog (static Jekyll): install package, then run `npm run sync:topography-toggle` in blog repo to copy `dist/browser.js` into `assets/js/vendor/topography-toggle.js`.
