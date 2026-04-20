#!/bin/bash

##############################################################################
# ndx Base Command Smoke Tests
#
# Tests core ndx commands: init, analyze, status, config
# Returns 0 on success, 1 on any failure
##############################################################################

set -e

echo "=== ndx Base Command Smoke Tests ==="
echo ""

# Test 1: ndx config
echo "[1/4] Testing: ndx config"
if pnpm exec ndx config; then
    echo "✓ ndx config succeeded"
else
    echo "✗ ndx config failed"
    exit 1
fi
echo ""

# Test 2: ndx init
echo "[2/4] Testing: ndx init"
if pnpm exec ndx init --provider=claude --model=claude-3-5-sonnet-20241022 . > /dev/null 2>&1; then
    echo "✓ ndx init succeeded"
else
    echo "✗ ndx init failed"
    exit 1
fi
echo ""

# Test 3: ndx analyze
echo "[3/4] Testing: ndx analyze"
if pnpm exec ndx analyze .; then
    echo "✓ ndx analyze succeeded"
else
    echo "✗ ndx analyze failed"
    exit 1
fi
echo ""

# Test 4: ndx status
echo "[4/4] Testing: ndx status"
if pnpm exec ndx status .; then
    echo "✓ ndx status succeeded"
else
    echo "✗ ndx status failed"
    exit 1
fi
echo ""

echo "=== All tests passed ==="
exit 0
