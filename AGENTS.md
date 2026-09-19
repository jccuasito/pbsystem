# Project instructions

## Keep the code maps current

After adding, removing, renaming, or changing a page, component, asset, style, frontend API call, server API route, or imported utility, run:

```powershell
node scripts/generate-code-map.cjs
```

Commit the resulting `docs/CODE_MAP.md` update with the code change. The generated map is the file-level route and dependency index for this project.

When backend behavior changes, also update `docs/API_MAP.md` with the endpoint, method, tables touched, caller, and request/response behavior. Do not replace its detailed API contract with the generated code map.
