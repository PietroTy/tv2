import json
import sys
from linker import save_json, save_js, load_existing_json

channels = load_existing_json()
ch_idx = 6

original_len = len(channels[ch_idx]["items"])
filtered_items = [
    item for item in channels[ch_idx]["items"]
    if item.get("id") != "k--cYhD9i1M"
]
new_len = len(filtered_items)

channels[ch_idx]["items"] = filtered_items
save_json(channels)
save_js(channels)
print(f"Removido(s) {original_len - new_len} vídeo(s) (O Monstro) do canal Pit.")
