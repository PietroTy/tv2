import sys
import os

# Ensure linker can be imported
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from linker import get_provider, process_playlist, define_episodes, load_existing_json, save_json, save_js

url = "https://www.youtube.com/playlist?list=PL2Z5fsSKe6rxbbdonScQmy74_B12Tk_Ja"
provider = get_provider()

print(f"Buscando vídeos de {url}...")
videos = process_playlist(provider, url)

if not videos:
    print("Nenhum vídeo encontrado!")
    sys.exit(1)

# Não vamos agrupar (define_episodes), vamos só mapear pra video
items = [{'type': 'video', **v} for v in videos]

new_channel = {
    "name": "sam",
    "label": "CH 09 · SAM",
    "items": items
}

channels = load_existing_json()
channels.append(new_channel)

save_json(channels)
save_js(channels)
print(f"Canal 9 (sam) adicionado com {len(items)} vídeos!")
