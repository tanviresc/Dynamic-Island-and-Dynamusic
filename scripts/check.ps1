$ErrorActionPreference = "Stop"

Write-Host "=== 1. Cargo fmt ===" -ForegroundColor Cyan
cargo fmt --all -- --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 2. Cargo clippy ===" -ForegroundColor Cyan
cargo clippy --workspace --all-targets --offline -- -D warnings
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 3. Cargo test ===" -ForegroundColor Cyan
cargo test --workspace --offline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 4. TypeScript Typecheck ===" -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 5. Vitest Tests ===" -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 6. Build Frontend & Extension ===" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 7. Cargo Build Workspace ===" -ForegroundColor Cyan
cargo build --workspace --offline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== ALL CHECKS PASSED ===" -ForegroundColor Green
