# F3 — suppress prose assistance in port search

**Status:** ready. **Branch group:** renderer hardening with F4/F5.
Read [execution index](README.md).

## Implementation boundary

Change the existing input in `apps/desktop/src/components/SearchInput.tsx` only:

```tsx
autoComplete="off"
autoCorrect="off"
autoCapitalize="off"
spellCheck={false}
```

Keep its ref, controlled value, `onChange`, text type, accessible name, placeholder,
search icon and clear button. Use a boolean for `spellCheck`, not the string `"false"`.
Do not change `filterPorts`, intercept typing, disable input selection or remove focus behavior.
These attributes ask WKWebView to disable assistance; they do not guarantee that every
macOS text service or input-method overlay is disabled.

## Steps and verification

1. Read the component and `App.tsx` search ref wiring.
2. Add the four props directly to the input, not its wrapper.
3. From `apps/desktop`, run `bun run check-types` and `bun run test`.
4. In the native app with spelling/autocorrection enabled at OS level, enter `postgress`,
   `rapportd`, `/Users/example/dev`, and `5173`. Pause after each word and press Space.
   Confirm no correction replaces the query and no correction bubble appears.
5. Verify substring filtering, numeric port-prefix filtering, clear button, `⌘A`, paste,
   arrow navigation and focus after panel open. Existing `Search port, app or folder`
   accessible name must still identify the input.

**Done:** input remains usable and no prose correction is observed in the tested environment.
If the OS does not reproduce a bubble before the fix, report preventive hardening rather
than a reproduced flicker fix. No dedicated attribute-mirroring test is required.

F7's new name/port form must apply the same text-assistance policy to its text inputs.
