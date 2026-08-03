#!/usr/bin/env python3
"""
Utilitário para desduplicar vídeos e títulos repetidos na grade da TV2.

Uso:
    python scripts/utils/clean_duplicates.py
"""

import sys
import os
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from linker import load_existing_json, save_json, save_js

def clean_title(t):
    return re.sub(r'\W+', '', (t or '').lower())

def deduplicate_channels():
    channels = load_existing_json()
    seen_video_ids = set()
    removed_count = 0
    removed_details = []
    cleaned_channels = []

    for ch in channels:
        cname = f"{ch['name']} ({ch['label']})"
        new_items = []
        seen_channel_titles = set()
        
        for item in ch['items']:
            if item['type'] == 'video':
                vid_id = item['id']
                t_clean = clean_title(item['title'])
                
                if vid_id in seen_video_ids:
                    removed_count += 1
                    removed_details.append(f"ID duplicado em {cname}: {vid_id} - '{item['title']}'")
                    continue
                    
                if t_clean and len(t_clean) > 5 and t_clean in seen_channel_titles:
                    removed_count += 1
                    removed_details.append(f"Título duplicado em {cname}: {vid_id} - '{item['title']}'")
                    continue
                    
                seen_video_ids.add(vid_id)
                if t_clean and len(t_clean) > 5:
                    seen_channel_titles.add(t_clean)
                new_items.append(item)
                
            elif item['type'] == 'episode':
                new_parts = []
                for p in item['parts']:
                    pid = p['id']
                    if pid in seen_video_ids:
                        removed_count += 1
                        removed_details.append(f"Parte duplicada em {cname} '{item['title']}': {pid} - '{p['title']}'")
                        continue
                    seen_video_ids.add(pid)
                    new_parts.append(p)
                if new_parts:
                    item['parts'] = new_parts
                    item['duration'] = sum(p['duration'] for p in new_parts)
                    new_items.append(item)

        ch['items'] = new_items
        cleaned_channels.append(ch)

    print(f"Total de itens duplicados removidos: {removed_count}")
    for d in removed_details:
        print(f"  • {d}")

    save_json(cleaned_channels)
    save_js(cleaned_channels)
    print("Grade de canais desduplicada e salva com sucesso!")
    return removed_count

if __name__ == "__main__":
    deduplicate_channels()
