import json
import os
import re
import sys

data_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'channels.json')
data_path_js = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'channels.js')

with open(data_path, 'r', encoding='utf-8') as f:
    channels = json.load(f)

def clean_title(title):
    t = re.sub(r'☆.*?☆', '', title)
    t = re.sub(r'\|.*$', '', t)
    t = re.sub(r'(?i)\s*-\s*YouTube$', '', t)
    t = re.sub(r'(?i)[\[\(](official|music video|lyric video|audio|video|completo|legendado|dublado|original|sam o\'nella)[^\]\)]*[\]\)]', '', t)
    t = re.sub(r'\(\d{4}\)', '', t)
    t = re.sub(r'(?i)-\s*(alta qualidade|sbt|hd|1080p|4k|hq)+', '', t)
    t = re.sub(r'(?i)[\[\(](hd|hq|1080p|4k)[\]\)]', '', t)
    t = re.sub(r'(?i)-\s*Part(?:e)?\s*\d+', '', t)
    t = re.sub(r'(?i)\bPart(?:e)?\s*\d+\b', '', t)
    t = re.sub(r'(?i)CUEIO\s*\d+', '', t)
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'\s*-\s*-\s*', ' - ', t)
    t = re.sub(r'^[\s\-\u2013\u2014!:\.]+|[\s\-\u2013\u2014!:\.]+$', '', t)
    return t.strip()

for ch in channels:
    for item in ch.get('videos', []):
        if 'title' in item:
            item['title'] = clean_title(item['title'])
        if 'parts' in item:
            for part in item['parts']:
                if 'title' in part:
                    part['title'] = clean_title(part['title'])

with open(data_path, 'w', encoding='utf-8') as f:
    json.dump(channels, f, ensure_ascii=False, indent=2)

def _render_video_js(v, indent):
    title = json.dumps(v.get('title', 'Unknown'), ensure_ascii=False)
    extra = ', ageRestricted: true' if v.get('ageRestricted') else ''
    dur = v.get('dur', 0)
    return f'{indent}{{ type: "yt", id: "{v.get("id")}", title: {title}, dur: {dur}{extra} }}'

def _render_episode_js(ep, indent):
    title = json.dumps(ep.get('title', 'Unknown'), ensure_ascii=False)
    dur = ep.get('dur', 0)
    lines = [f'{indent}{{']
    lines.append(f'{indent}  type: "episode",')
    lines.append(f'{indent}  title: {title},')
    lines.append(f'{indent}  dur: {dur},')
    lines.append(f'{indent}  parts: [')
    for p in ep.get('parts', []):
        lines.append(_render_video_js(p, indent + '    ') + ',')
    lines.append(f'{indent}  ]')
    lines.append(f'{indent}}}')
    return '\n'.join(lines)

def _render_item_js(item, indent):
    if item.get('type') == 'video':
        return _render_video_js(item, indent)
    return _render_episode_js(item, indent)

lines = []
lines.append("const CHANNELS = [")
for ch in channels:
    lines.append("  {")
    lines.append(f'    name:  {json.dumps(ch.get("name", ""),  ensure_ascii=False)},')
    lines.append(f'    label: {json.dumps(ch.get("label", ""), ensure_ascii=False)},')
    lines.append("    videos: [")
    for it in ch.get('videos', []):
        lines.append(_render_item_js(it, "      ") + ",")
    lines.append("    ]")
    lines.append("  },")
lines.append("];")
with open(data_path_js, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')

print("Títulos normalizados com sucesso!")
