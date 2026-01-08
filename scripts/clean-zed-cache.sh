#!/bin/bash
# Clean Zed extension caches

echo "Cleaning Zed caches for koda-agent..."

# Stop any running agent processes
pkill -f agent_server.mjs

# Remove cached agent versions
rm -rf ~/.var/app/dev.zed.Zed/data/zed/external_agents/koda-agent 2>/dev/null
rm -rf /var/home/$USER/.var/app/dev.zed.Zed/data/zed/external_agents/koda-agent 2>/dev/null

# Remove extension work directory
rm -rf ~/.var/app/dev.zed.Zed/data/zed/extensions/work/koda-agent 2>/dev/null
rm -rf /var/home/$USER/.var/app/dev.zed.Zed/data/zed/extensions/work/koda-agent 2>/dev/null

echo "✓ Caches cleaned"
echo "Please restart Zed and reload the extension"
