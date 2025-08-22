#!/bin/bash

# Script to set the app to always-on mode
echo "Setting app to always-on mode..."

# Update fly.toml to keep machines running
sed -i '' 's/auto_stop_machines = true/auto_stop_machines = false/' fly.toml
sed -i '' 's/min_machines_running = 0/min_machines_running = 1/' fly.toml

# Remove autostop configuration if it exists (for always-on mode)
sed -i '' '/\[\[http_service\.autostop\]\]/,/autostop_timeout = "[^"]*"/d' fly.toml

echo "Updated fly.toml for always-on mode:"
echo "- auto_stop_machines = false"
echo "- min_machines_running = 1"
echo "- Removed autostop configuration (always on)"
echo ""

# Deploy the changes
echo "Deploying changes..."
if fly deploy; then
    echo "✅ App is now set to always-on mode!"
else
    echo "❌ Deployment failed. You can try running 'fly deploy' manually."
    echo "Common fixes:"
    echo "- Check your internet connection"
    echo "- Try again in a few minutes (API might be temporarily unavailable)"
    echo "- Run 'fly auth login' if authentication expired"
    exit 1
fi
