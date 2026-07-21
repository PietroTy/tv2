import json
import sys
from linker import get_provider, process_playlist, build_channel, item_to_output, channel_to_output, save_json, save_js, load_existing_json, define_episodes

provider = get_provider()
url = "https://www.youtube.com/playlist?list=PLKwWEf8fH9Wg"
print(f"Fetching playlist {url}")
videos = process_playlist(provider, url)

items = define_episodes(videos)
ch = {
    "name": "Rogerio",
    "label": "CH 04 · ROGERIO",
    "items": items
}

channels = load_existing_json()
if len(channels) >= 4:
    channels[3] = ch
else:
    channels.append(ch)

save_json(channels)
save_js(channels)
print("Done")
