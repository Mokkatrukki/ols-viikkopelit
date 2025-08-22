#!/bin/bash

# Script to set the app to sleep mode (auto-stop after 1 hour of inactivity)
echo "Setting app to sleep mode with 1-hour stay-up time..."

# First, check if we need to add autostop configuration
if ! grep -q "autostop" fly.toml; then
    # Add autostop configuration after the http_service.checks section
    sed -i '' '/method = "GET"/a\
\
  [[http_service.autostop]]\
    kill_signal = "SIGINT"\
    kill_timeout = "5s"\
    min_machines_running = 0\
    autostop_timeout = "1h"
' fly.toml
fi

# Update fly.toml to allow machines to sleep after 1 hour of inactivity
sed -i '' 's/auto_stop_machines = false/auto_stop_machines = true/' fly.toml
sed -i '' 's/min_machines_running = 1/min_machines_running = 0/' fly.toml

# Update autostop timeout if it exists
sed -i '' 's/autostop_timeout = "[^"]*"/autostop_timeout = "1h"/' fly.toml

echo "Updated fly.toml for sleep mode:"
echo "- auto_stop_machines = true"
echo "- min_machines_running = 0"
echo "- autostop_timeout = 1h (stays up 1 hour after last request)"
echo ""

# Deploy the changes
echo "Deploying changes..."
if fly deploy; then
    echo "✅ App is now set to sleep mode (will auto-stop when idle)!"
else
    echo "❌ Deployment failed. You can try running 'fly deploy' manually."
    echo "Common fixes:"
    echo "- Check your internet connection"
    echo "- Try again in a few minutes (API might be temporarily unavailable)"
    echo "- Run 'fly auth login' if authentication expired"
    exit 1
fi
