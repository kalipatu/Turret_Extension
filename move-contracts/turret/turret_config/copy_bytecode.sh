#!/bin/bash

# Script: copy_bytecode.sh
# Copies turret bytecode files to the dapps public directory

# Get the current directory (should be turret_extension/move-contracts/turret/turret_config)
CURRENT_DIR="$(pwd)"

# Verify we're in the expected directory
if [[ ! "$CURRENT_DIR" =~ "turret_extension/move-contracts/turret/turret_config" ]]; then
    echo "Warning: Script might not be in the expected directory"
    echo "Current directory: $CURRENT_DIR"
    echo "Expected: .../turret_extension/move-contracts/turret/turret_config"
    echo ""
fi





# Define source paths (relative to current directory)
SOURCE_MODULE="build/turret_config/bytecode_modules/turret.mv"
SOURCE_DUMP="bytecode_dump.json"

# Define target directory (relative path up and into dapps)
TARGET_DIR="../../../dapps/public/bytecode"

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Copy the files
echo "Copying turret.mv..."
cp "$SOURCE_MODULE" "$TARGET_DIR/"

echo "Copying bytecode_dump.json..."
cp "$SOURCE_DUMP" "$TARGET_DIR/"

# Verify copies were successful
if [ $? -eq 0 ]; then
    echo "Files copied successfully to: $(cd "$TARGET_DIR" && pwd)"
    echo ""
    echo "Copied files:"
    echo "  - turret.mv"
    echo "  - bytecode_dump.json"
else
    echo "Error: Failed to copy files"
    exit 1
fi