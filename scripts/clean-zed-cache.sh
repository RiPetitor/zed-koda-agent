#!/bin/bash
# Clean Zed extension caches

echo "Cleaning Zed caches for koda-agent..."

# Stop any running agent processes
pkill -f agent_server.mjs
sleep 1

# Remove cached agent versions (both /home and /var/home)
rm -rf ~/.var/app/dev.zed.Zed/data/zed/external_agents/koda-agent 2>/dev/null
rm -rf /home/$USER/.var/app/dev.zed.Zed/data/zed/external_agents/koda-agent 2>/dev/null
rm -rf /var/home/$USER/.var/app/dev.zed.Zed/data/zed/external_agents/koda-agent 2>/dev/null

# Remove extension work directory
rm -rf ~/.var/app/dev.zed.Zed/data/zed/extensions/work/koda-agent 2>/dev/null
rm -rf /home/$USER/.var/app/dev.zed.Zed/data/zed/extensions/work/koda-agent 2>/dev/null
rm -rf /var/home/$USER/.var/app/dev.zed.Zed/data/zed/extensions/work/koda-agent 2>/dev/null

echo "✓ Caches cleaned"
echo "✓ Agent processes stopped"
echo ""
echo "Next steps:"
echo "1. Restart Zed completely"
echo "2. Reinstall dev extension: Ctrl+Shift+P → 'zed: install dev extension'"
