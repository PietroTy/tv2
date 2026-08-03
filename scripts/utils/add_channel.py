#!/usr/bin/env python3
"""
Utilitário para adicionar ou atualizar um canal a partir de URLs do YouTube (playlists/vídeos).

Uso:
    python scripts/utils/add_channel.py --name "nome_canal" --label "CH XX · RÓTULO" --urls "URL1" "URL2"
"""

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from linker import get_provider, process_playlist, process_single_video, load_existing_json, save_json, save_js

def add_or_update_channel(name, label, urls, min_dur=10, max_dur=3600):
    provider = get_provider()
    all_videos = []

    for url in urls:
        print(f"Buscando conteúdos de: {url}")
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
            continue
        if dur < min_dur:
            continue
        if dur > max_dur:
            continue
            
        seen_ids.add(vid_id)
        filtered_videos.append(v)

    if not filtered_videos:
        print("Nenhum vídeo válido restou após filtragem!")
        return False

    items = [{'type': 'video', **v} for v in filtered_videos]

    new_channel = {
        "name": name,
        "label": label,
        "items": items
    }

    channels = load_existing_json()
    ch_idx = -1
    for i, ch in enumerate(channels):
        if ch.get("name", "").lower() == name.lower():
            ch_idx = i
            break

    if ch_idx >= 0:
        channels[ch_idx] = new_channel
        print(f"Canal '{name}' ({label}) atualizado com sucesso!")
    else:
        channels.append(new_channel)
        print(f"Novo canal '{name}' ({label}) adicionado com sucesso!")

    save_json(channels)
    save_js(channels)
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Adicionar ou atualizar canal na TV2")
    parser.add_argument("--name", required=True, help="Nome/ID interno do canal (ex: musica)")
    parser.add_argument("--label", required=True, help="Rótulo exibido na TV (ex: 'CH 04 · CLIPES & MÚSICA')")
    parser.add_argument("--urls", nargs="+", required=True, help="Uma ou mais URLs do YouTube")
    
    args = parser.parse_args()
    add_or_update_channel(args.name, args.label, args.urls)
