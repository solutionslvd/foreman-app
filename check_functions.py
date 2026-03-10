import subprocess
import re

# Get all onclick handlers from app.html
result = subprocess.run(
    ['grep', '-oP', 'onclick="[^"]*"', 'app.html'],
    capture_output=True, text=True, cwd='/workspace/web'
)

handlers = result.stdout.strip().split('\n')
functions_called = set()

for handler in handlers:
    # Extract function calls
    handler = handler.replace('onclick="', '').replace('"', '')
    # Split by semicolons and extract function names
    parts = handler.split(';')
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # Extract function name (first word before parenthesis)
        match = re.match(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', part)
        if match:
            functions_called.add(match.group(1))

# Also check for document.getElementById calls (these are inline JS, not function calls)
functions_called.discard('document')

print("Functions called from onclick handlers in app.html:")
print("=" * 60)

# Get all functions defined in app.js
result = subprocess.run(
    ['grep', '-oP', r'^function [a-zA-Z_][a-zA-Z0-9_]*', 'app.js'],
    capture_output=True, text=True, cwd='/workspace/web'
)

defined_functions = set()
for line in result.stdout.strip().split('\n'):
    if line:
        func_name = line.replace('function ', '')
        defined_functions.add(func_name)

# Find missing functions
missing = functions_called - defined_functions
defined = functions_called & defined_functions

print(f"\nTotal unique functions called: {len(functions_called)}")
print(f"Functions defined in app.js: {len(defined_functions)}")
print(f"Functions FOUND: {len(defined)}")
print(f"Functions MISSING: {len(missing)}")

if missing:
    print("\n[MISSING FUNCTIONS - POTENTIAL DEAD ENDS]:")
    print("-" * 60)
    for func in sorted(missing):
        print(f"  - {func}")

# Check which HTML elements call the missing functions
if missing:
    print("\n[WHERE MISSING FUNCTIONS ARE CALLED]:")
    print("-" * 60)
    for func in sorted(missing):
        result = subprocess.run(
            ['grep', '-n', f'{func}(', 'app.html'],
            capture_output=True, text=True, cwd='/workspace/web'
        )
        lines = result.stdout.strip().split('\n')[:3]  # Show first 3 occurrences
        for line in lines:
            if line:
                print(f"  Line {line[:80]}")
