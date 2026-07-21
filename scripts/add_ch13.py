import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from linker import get_provider, process_playlist, process_single_video, load_existing_json, save_json, save_js

urls = [
    "https://www.youtube.com/playlist?list=PL6obTLJTJH834Z7tiMKS2jfYkCRMAlKP2",
    "https://www.youtube.com/playlist?list=PL6obTLJTJH81scZfdm7pA2Mh4_OYsEU2R",
    "https://www.youtube.com/playlist?list=PL6obTLJTJH80prwpstuT3lqeN_XEfnFac",
    "https://www.youtube.com/playlist?list=PLMantqYKdiBvZus2P1nm1t8IQpsTFs-8y",
    "https://www.youtube.com/watch?v=L2zbAKIOyjU"
]

provider = get_provider()
all_videos = []

for url in urls:
    print(f"Buscando vídeos de {url}...")
    if "playlist" in url:
        vids = process_playlist(provider, url)
    else:
        vids = process_single_video(provider, url)
    if vids:
        all_videos.extend(vids)

filtered_videos = []
seen_ids = set()

for v in all_videos:
    vid_id = v.get('id')
    dur = v.get('duration', 0)
    
    if vid_id in seen_ids:
        print(f"Duplicado removido: {vid_id} - {v.get('title')}")
        continue
    
    if dur < 10:
        print(f"Muito curto removido ({dur}s): {vid_id} - {v.get('title')}")
        continue
        
    if dur > 480:
        print(f"Muito longo removido ({dur}s): {vid_id} - {v.get('title')}")
        continue
        
    seen_ids.add(vid_id)
    filtered_videos.append(v)

if not filtered_videos:
    print("Nenhum vídeo válido restou!")
    sys.exit(1)

items = [{'type': 'video', **v} for v in filtered_videos]

new_channel = {
    "name": "mix",
    "label": "CH 13 · MIX",
    "items": items
}

channels = load_existing_json()
channels.append(new_channel)

save_json(channels)
save_js(channels)
print(f"Canal 13 (mix) adicionado com {len(items)} vídeos (filtrados de {len(all_videos)} totais)!")
