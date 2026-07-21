import json
import sys
from linker import get_provider, process_playlist, build_channel, item_to_output, channel_to_output, save_json, save_js, load_existing_json, define_episodes

provider = get_provider()
url = "https://www.youtube.com/playlist?list=PLfkgawoW7Wql7SxZw5YIdTYSqxeX0Egxz"
print(f"Fetching playlist {url}")
videos = process_playlist(provider, url)

items = define_episodes(videos)
ch = {
    "name": "Telaclass",
    "label": "CH 06 · TELACLASS",
    "items": items
}

channels = load_existing_json()
if len(channels) >= 6:
    channels[5] = ch
else:
    # Pad se faltar canal
    while len(channels) < 5:
        channels.append({"name": f"Vazio {len(channels)+1}", "label": f"CH 0{len(channels)+1} VAZIO", "items": []})
    channels.append(ch)

save_json(channels)
save_js(channels)
print("Done")
