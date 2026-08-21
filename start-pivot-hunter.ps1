# Starts Pivot Hunter's production preview server.
# Run manually to test, or invoked automatically by the "Pivot Hunter Startup"
# Scheduled Task (registered to trigger at user logon).
#
# Serves the already-built dist/ folder — after changing source code, run
# `npm run build` again so the server picks up the new build.

Set-Location -Path $PSScriptRoot
npm run preview
