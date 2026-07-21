import json
import sys
from linker import get_provider, process_playlist, build_channel, item_to_output, channel_to_output, save_json, save_js, load_existing_json, define_episodes

provider = get_provider()
url = "https://youtube.com/playlist?list=PL_yAGfStEDOqs7-AgNqR02imen6feOnZN"
print(f"Fetching playlist {url}")
videos = process_playlist(provider, url)

items = define_episodes(videos)
ch = {
    "name": "Ed",
    "label": "CH 05 · ED",
    "items": items
}

channels = load_existing_json()
if len(channels) >= 5:
    channels[4] = ch
else:
    # Pad if less than 5
    while len(channels) < 4:
        channels.append({"name": f"Vazio {len(channels)+1}", "label": f"CH 0{len(channels)+1} VAZIO", "items": []})
    channels.append(ch)

save_json(channels)
save_js(channels)
print("Done")
