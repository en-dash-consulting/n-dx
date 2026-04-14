// Quick manual test of token formatting
function formatTokenValue(count, width = 8) {
  if (count === null || count === undefined || count < 0) {
    return "—".padStart(width);
  }
  return count.toLocaleString().padStart(width);
}

function formatTokenReport(tokens) {
  if (!tokens) {
    return `tokens_in: ${formatTokenValue(null)}\ntokens_out: ${formatTokenValue(null)}`;
  }

  const inputFormatted = formatTokenValue(tokens.input);
  const outputFormatted = formatTokenValue(tokens.output);

  return `tokens_in: ${inputFormatted}\ntokens_out: ${outputFormatted}`;
}

// Test cases
console.log("=== Test 1: Normal tokens ===");
console.log(formatTokenReport({ input: 1500, output: 300 }));
console.log();

console.log("=== Test 2: Large tokens ===");
console.log(formatTokenReport({ input: 999999, output: 888888 }));
console.log();

console.log("=== Test 3: Small tokens ===");
console.log(formatTokenReport({ input: 1, output: 2 }));
console.log();

console.log("=== Test 4: Zero/unavailable ===");
console.log(formatTokenReport({ input: 0, output: 0 }));
console.log();

console.log("=== Test 5: Null ===");
console.log(formatTokenReport(null));
console.log();

console.log("=== Visual alignment test ===");
const test1 = formatTokenReport({ input: 1, output: 999999 });
const test2 = formatTokenReport({ input: 123456, output: 654321 });
console.log("Test 1:");
console.log(test1);
console.log("\nTest 2:");
console.log(test2);
