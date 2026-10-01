"""
Procedural audio generator for Awuuu the Dog companion.
Generates 100% royalty-free, open-source custom sound effects
using mathematical synthesis (FM, harmonics, ADSR, sweep).
"""

import math
import os
import struct
import wave

SAMPLE_RATE = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "shared", "sounds")


def clamp(val, low=-1.0, high=1.0):
    return max(low, min(high, val))


def write_wav(filename, samples):
    path = os.path.join(OUT_DIR, filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "w") as w:
        w.setnchannels(1)  # Mono
        w.setsampwidth(2)  # 16-bit
        w.setframerate(SAMPLE_RATE)
        raw = bytearray()
        for s in samples:
            s_clamped = clamp(s)
            val = int(s_clamped * 32767)
            raw.extend(struct.pack("<h", val))
        w.writeframes(raw)
    print(f"Generated {filename}: {len(samples)} samples ({len(samples)/SAMPLE_RATE:.2f}s)")


def env_adsr(t, total_len, attack=0.02, decay=0.08, sustain=0.4, release=0.1):
    if t < attack:
        return t / attack
    elif t < attack + decay:
        d_phase = (t - attack) / decay
        return 1.0 - (1.0 - sustain) * d_phase
    elif t < total_len - release:
        return sustain
    elif t < total_len:
        r_phase = (total_len - t) / release
        return sustain * r_phase
    return 0.0


def synth_howl_greet():
    # Awuuu! Playful wolf puppy howl sliding from 320Hz up to 680Hz and settling
    dur = 1.1
    n = int(SAMPLE_RATE * dur)
    samples = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        # Frequency sweep curve
        if t < 0.4:
            f = 320 + 360 * math.sin((t / 0.4) * (math.pi / 2))
        else:
            f = 680 - 180 * ((t - 0.4) / 0.7)
        # Vibrato
        vib = 6.0 * math.sin(2 * math.pi * 5.5 * t)
        f += vib
        phase += 2 * math.pi * f / SAMPLE_RATE

        # Harmonic richness
        s = 0.6 * math.sin(phase) + 0.25 * math.sin(2 * phase) + 0.1 * math.sin(3 * phase)
        # Envelope
        env = env_adsr(t, dur, attack=0.12, decay=0.2, sustain=0.6, release=0.35)
        samples.append(s * env * 0.75)
    return samples


def synth_bell_chime(f1=880, f2=1320, dur=0.6):
    n = int(SAMPLE_RATE * dur)
    samples = []
    p1 = 0.0
    p2 = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        p1 += 2 * math.pi * f1 / SAMPLE_RATE
        p2 += 2 * math.pi * f2 / SAMPLE_RATE
        s = 0.6 * math.sin(p1) + 0.3 * math.sin(p2) + 0.1 * math.sin(p1 * 2)
        env = math.exp(-6.5 * t)
        samples.append(s * env * 0.8)
    return samples


def synth_puppy_chirp(start_f=500, end_f=1100, dur=0.25):
    n = int(SAMPLE_RATE * dur)
    samples = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        k = t / dur
        f = start_f + (end_f - start_f) * (k ** 0.8)
        phase += 2 * math.pi * f / SAMPLE_RATE
        s = 0.7 * math.sin(phase) + 0.2 * math.sin(2 * phase)
        env = math.sin(math.pi * k)
        samples.append(s * env * 0.8)
    return samples


def synth_whimper_error(dur=0.45):
    n = int(SAMPLE_RATE * dur)
    samples = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        k = t / dur
        f = 750 - 450 * (k ** 0.7) + 12 * math.sin(2 * math.pi * 9 * t)
        phase += 2 * math.pi * f / SAMPLE_RATE
        s = 0.6 * math.sin(phase) + 0.25 * math.sin(2 * phase)
        env = env_adsr(t, dur, attack=0.03, decay=0.1, sustain=0.4, release=0.2)
        samples.append(s * env * 0.7)
    return samples


def synth_victory_finish(dur=0.85):
    # Joyful triad arpeggio (C5 -> E5 -> G5 -> C6)
    notes = [523.25, 659.25, 783.99, 1046.50]
    sub_dur = dur / len(notes)
    samples = []
    for idx, f in enumerate(notes):
        n_sub = int(SAMPLE_RATE * sub_dur)
        p = 0.0
        for i in range(n_sub):
            t = i / SAMPLE_RATE
            p += 2 * math.pi * f / SAMPLE_RATE
            s = 0.6 * math.sin(p) + 0.25 * math.sin(2 * p) + 0.1 * math.sin(3 * p)
            env = math.exp(-4.5 * t)
            samples.append(s * env * 0.75)
    return samples


def synth_grumble_annoyed(dur=0.35):
    n = int(SAMPLE_RATE * dur)
    samples = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        k = t / dur
        f = 160 + 40 * math.sin(2 * math.pi * 14 * t)
        phase += 2 * math.pi * f / SAMPLE_RATE
        s = 0.5 * math.sin(phase) + 0.3 * math.sin(2 * phase) + 0.15 * math.sin(3 * phase)
        env = math.sin(math.pi * k)
        samples.append(s * env * 0.7)
    return samples


def synth_wobble_dizzy(dur=0.6):
    n = int(SAMPLE_RATE * dur)
    samples = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        f = 350 + 120 * math.sin(2 * math.pi * 8 * t)
        phase += 2 * math.pi * f / SAMPLE_RATE
        s = 0.6 * math.sin(phase) + 0.2 * math.sin(2 * phase)
        env = math.exp(-3.0 * t)
        samples.append(s * env * 0.75)
    return samples


def synth_question(dur=0.32):
    return synth_puppy_chirp(420, 920, dur)


def synth_pop(dur=0.08):
    n = int(SAMPLE_RATE * dur)
    samples = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        f = 800 - 600 * (t / dur)
        phase += 2 * math.pi * f / SAMPLE_RATE
        s = math.sin(phase)
        env = math.exp(-35.0 * t)
        samples.append(s * env * 0.8)
    return samples


def synth_tick(dur=0.04):
    n = int(SAMPLE_RATE * dur)
    samples = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        phase += 2 * math.pi * 1800 / SAMPLE_RATE
        s = math.sin(phase)
        env = math.exp(-90.0 * t)
        samples.append(s * env * 0.5)
    return samples


def synth_swoosh(dur=0.25, upward=True):
    n = int(SAMPLE_RATE * dur)
    samples = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        k = t / dur
        if upward:
            f = 250 + 700 * (k ** 1.5)
        else:
            f = 850 - 600 * (k ** 1.2)
        phase += 2 * math.pi * f / SAMPLE_RATE
        s = 0.7 * math.sin(phase)
        env = math.sin(math.pi * k)
        samples.append(s * env * 0.6)
    return samples


def synth_love(dur=0.65):
    # Warm bell chord
    n = int(SAMPLE_RATE * dur)
    samples = []
    p1, p2, p3 = 0.0, 0.0, 0.0
    f1, f2, f3 = 587.33, 739.99, 880.0  # D major chord
    for i in range(n):
        t = i / SAMPLE_RATE
        p1 += 2 * math.pi * f1 / SAMPLE_RATE
        p2 += 2 * math.pi * f2 / SAMPLE_RATE
        p3 += 2 * math.pi * f3 / SAMPLE_RATE
        s = 0.35 * math.sin(p1) + 0.35 * math.sin(p2) + 0.25 * math.sin(p3)
        env = math.exp(-4.2 * t)
        samples.append(s * env * 0.8)
    return samples


def generate_all():
    sounds = {
        "greet.wav": synth_howl_greet(),
        "approval.wav": synth_bell_chime(784, 1175, 0.45),
        "approve.wav": synth_puppy_chirp(580, 1050, 0.22),
        "error.wav": synth_whimper_error(0.45),
        "finish.wav": synth_victory_finish(0.75),
        "annoyed.wav": synth_grumble_annoyed(0.32),
        "dizzy.wav": synth_wobble_dizzy(0.55),
        "question.wav": synth_question(0.30),
        "pop.wav": synth_pop(0.08),
        "blip.wav": synth_bell_chime(1200, 1800, 0.12),
        "tick.wav": synth_tick(0.04),
        "hover.wav": synth_bell_chime(1400, 2100, 0.08),
        "open.wav": synth_swoosh(0.22, upward=True),
        "close.wav": synth_swoosh(0.18, upward=False),
        "peek.wav": synth_puppy_chirp(700, 1100, 0.14),
        "send.wav": synth_swoosh(0.24, upward=True),
        "love.wav": synth_love(0.65),
        "proud.wav": synth_victory_finish(0.6),
        "wink.wav": synth_bell_chime(1500, 2250, 0.15),
        "yawn.wav": synth_whimper_error(0.55),
        "attach.wav": synth_pop(0.12),
        "think.wav": synth_bell_chime(520, 780, 0.25),
        "search.wav": synth_puppy_chirp(600, 1200, 0.18),
        "rate.wav": synth_bell_chime(880, 880, 0.28),
        "sleep.wav": synth_love(0.8),
        "work.wav": synth_tick(0.06),
        "gulp.wav": synth_pop(0.15),
        "slap.wav": synth_pop(0.1),
    }

    for name, data in sounds.items():
        write_wav(name, data)
    print("All 28 Awuuu sounds generated successfully!")


if __name__ == "__main__":
    generate_all()
