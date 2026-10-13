// lint-staged configuration.
//
// Why a function instead of the simple string form: on Windows, lint-staged
// appends every matched file path to the command. Large staged sets (200+ files)
// overflow the cmd.exe command-line length limit ("The command line is too long").
// Returning a single `biome check --staged` invocation lets Biome discover the
// staged files itself, so the command length is constant regardless of how many
// files are staged.
export default {
  "*.{ts,js,json}": () => "biome check --staged --diagnostic-level=error --no-errors-on-unmatched",
};
