import json
import sys
from linker import get_provider, process_playlist, build_channel, item_to_output, channel_to_output, save_json, save_js, load_existing_json, define_episodes

provider = get_provider()
url = "https://www.youtube.com/playlist?list=PLgZmV74WN8RUSYRGDlWIXUtLSMYlgPIy7"
print(f"Fetching playlist {url}")
videos = process_playlist(provider, url)

items = define_episodes(videos)
ch = {
    "name": "Pit",
    "label": "CH 07 · PIT",
    "items": items
}

channels = load_existing_json()
if len(channels) >= 7:
    channels[6] = ch
else:
    # Pad se faltar canal
    while len(channels) < 6:
        channels.append({"name": f"Vazio {len(channels)+1}", "label": f"CH 0{len(channels)+1} VAZIO", "items": []})
    channels.append(ch)

save_json(channels)
save_js(channels)
print("Done")
