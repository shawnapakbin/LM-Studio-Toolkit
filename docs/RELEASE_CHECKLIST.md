# Release Checklist

## Pre-Release Validation

### 0. Version Scope Marker ✅
- [ ] Confirm `docs/VNEXT_FEATURES.md` exists and lists all intentional next-version features
- [ ] Confirm any new feature-level directory/file set is represented in `docs/VNEXT_FEATURES.md`
- [ ] Run `npm run verify:vnext-scope` and confirm it passes
- [ ] Confirm release PR title/labels reflect vNext scope (for example: `feat(vnext): ...`)

### 1. Code Quality ✅
- [ ] Run `npm run check:ci` (format + lint + import organization)
- [ ] Run `npm run type-check` (TypeScript strict mode)
- [ ] All checks pass with zero errors

### 2. Tests & Coverage ✅
- [ ] Run `npm run test:ci`
- [ ] Coverage meets minimum thresholds (80%+ overall)
- [ ] Individual tool coverage targets met:
  - Terminal: 85%+
  - Calculator: 90%+
- [ ] No failing tests

### 3. Build Verification ✅
- [ ] Run `npm run build`
- [ ] All tools compile successfully
- [ ] Check `dist/` directories exist for all tools:
  - Terminal/dist/
  - WebBrowser/dist/
  - Calculator/dist/
  - DocumentScraper/dist/
  - Clock/dist/
  - Browserless/dist/
  - AskUser/dist/
  - RAG/dist/
  - Skills/dist/
  - ECM/dist/
  - Memory/dist/
  - AgentRunner/dist/
  - Observability/dist/
  - CSVExporter/dist/
  - Git/dist/
  - FileEditor/dist/
  - PackageManager/dist/
  - CLI/dist/
  - SlashCommands/dist/

### 4. MCP Readiness ✅
- [ ] Run `npm run startup:check:strict`
- [ ] All MCP binaries present (`dist/mcp-server.js`)
- [ ] Environment variables validated
- [ ] `mcp.json` configuration synchronized with README
- [ ] Run `npm run test:mcp` and confirm MCP integration suites pass for AskUser, RAG, and Terminal
- [ ] Run live gates (`npm run test:mcp:live` and `npm run test:mcp:live:matrix`) with `LMSTUDIO_LIVE_TEST=true`
- [ ] Confirm matrix flow unloads all loaded LM Studio models before loading each target model

### 5. Evaluation & Regression ✅
- [ ] Run `npm run eval:run`
- [ ] Pass rate meets baseline threshold
- [ ] Average retries within acceptable range
- [ ] Run `npm run eval:drift` to check for regressions
- [ ] Review golden traces for anomalies

### 6. Complete Verification ✅
- [ ] Run `npm run verify:all`
- [ ] All quality gates pass
- [ ] No critical warnings

## Pre-Release Documentation

### 7. Update Version Numbers 📝
- [ ] Update `version` in root `package.json`
- [ ] Update `version` in all tool package.json files
- [ ] Follow semantic versioning:
  - **Major (X.0.0)**: Breaking API changes
  - **Minor (0.X.0)**: New features, backwards compatible
  - **Patch (0.0.X)**: Bug fixes, minor improvements

### 8. Changelog & Release Notes 📝
- [ ] Update `CHANGELOG.md` with:
  - New features
  - Bug fixes
  - Breaking changes
  - Deprecations
- [ ] Draft GitHub release notes
- [ ] Include migration guide if breaking changes

### 9. Documentation Review 📝
- [ ] README.md is current
- [ ] All tool READMEs updated
- [ ] API documentation reflects changes
- [ ] Code examples tested and working
- [ ] Architecture diagrams current

## Release Execution

### 10. Git Tagging 🏷️
```bash
# Create annotated tag
git tag -a v1.0.0 -m "Release v1.0.0: Phase 1 Complete"

# Verify tag
git tag -l -n9 v1.0.0

# Push tag
git push origin v1.0.0
```

### 11. GitHub Release 🚀
- [ ] Create release from tag
- [ ] Add release notes from CHANGELOG
- [ ] Attach artifacts if applicable:
  - Build outputs (optional)
  - Documentation PDF (optional)
- [ ] Mark as pre-release if beta/alpha

### 12. NPM Publish (if applicable) 📦
```bash
# Dry run first
npm publish --dry-run

# Publish (if public)
npm publish

# Or publish to private registry
npm publish --registry https://your-registry.com
```

## Post-Release Validation

### 13. Smoke Tests 🧪
- [ ] Fresh clone of repository
- [ ] Run `npm install`
- [ ] Run `npm run verify:all`
- [ ] Start MCP server: `npm run -w Terminal start:mcp`
- [ ] Test basic tool operations
- [ ] Verify LM Studio integration

### 14. Dependency Check 🔍
```bash
# Check for vulnerabilities
npm audit

# Check for outdated packages (informational)
npm outdated
```

### 15. Monitoring & Rollback Plan 📊
- [ ] Monitor issue tracker for bug reports
- [ ] Have rollback procedure ready:
  ```bash
  # Revert to previous tag
  git checkout v0.9.0
  npm install
  npm run build
  ```
- [ ] Document known issues in release notes if any

## Communication

### 16. Announcements 📢
- [ ] Update project status in README
- [ ] Notify team/community via:
  - GitHub Discussions
  - Discord/Slack
  - Email list
- [ ] Share release notes and highlights
- [ ] Update roadmap status

## Checklist Summary

**All checks must pass before release:**

```bash
npm run verify:all && \
npm run eval:drift && \
test -f docs/VNEXT_FEATURES.md && \
echo "✅ Ready for release"
```

**Quick release commands:**
```bash
# 1. Update versions
npm version minor  # or major/patch

# 2. Build and test
npm run verify:all

# 3. Tag and push
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0

# 4. Create GitHub release
# (via GitHub UI or gh CLI)
```

## Emergency Rollback

If critical issues discovered post-release:

```bash
# 1. Revert to previous stable tag
git checkout v0.9.0

# 2. Create hotfix branch
git checkout -b hotfix/critical-fix

# 3. Apply minimal fix

# 4. Test thoroughly
npm run verify:all

# 5. Release as patch version
npm version patch
git push origin hotfix/critical-fix
git tag -a v0.9.1 -m "Hotfix: Critical bug"
git push origin v0.9.1
```

## Commit Strategy

- [ ] Split commits by concern (feature code, installer mirror, docs/changelog)
- [ ] Keep unrelated workspace changes out of release commits
- [ ] Keep generated/runtime artifacts (for example local SQLite files) out of commits
- [ ] Verify installer payload mirrors canonical source before tagging release

## Notes

- **Pre-releases**: Use `-alpha`, `-beta`, `-rc` suffixes (e.g., `v1.0.0-beta.1`)
- **Breaking changes**: Require major version bump and migration guide
- **Security fixes**: Prioritize and release ASAP, notify users directly
- **Deprecations**: Give at least one minor version notice before removal

## Sign-Off

- [ ] Release manager approval
- [ ] QA sign-off
- [ ] Documentation team approval
- [ ] Stakeholder notification complete

**Release Date**: ________________

**Released By**: ________________

**Version**: ________________
