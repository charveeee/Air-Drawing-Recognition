# Air-Drawing Recognition System

A computer vision web application that turns hands into a digital canvas! Draw shapes mid-air using hand tracking and manipulate your artwork on screen using gesture controls—no physical drawing board or stylus needed.

---

## Features

* **Mid-Air Drawing:** Trace shapes in the air using your index finger.
* **Shape Recognition:** Automatically recognizes closed freehand strokes and snaps them into clean geometric shapes (circles, squares, etc.).
* **Two-Hand Move & Zoom Mode:** Switch to move mode to pan and scale your drawings using both hands.
* **Gesture Controls:** Perform quick hand gestures to trigger actions like Undo, Redo, Clear Canvas, and Color Cycling.
* **Zero Installation Required:** Built with MediaPipe Web SDK to run directly inside any modern browser.

---

## Gesture Controls Guide

| Gesture | Action |
| :--- | :--- |
| 👆 **Point (Index Finger)** | **Draw** — Trace shapes mid-air |
| ✌️ **Peace Sign** | **Toggle Move Mode** — Pan/Zoom artwork |
| 🖖 **Three Fingers Up** | **Undo** last drawn shape |
| ✋ **Open Palm** | **Redo** last undone shape |
| 👌 **OK Sign** | **Clear** entire canvas |
| 👍 **Thumbs Up** | **Cycle Drawing Colors** |

---

## How It Works

1. **Hand Tracking:** Uses **MediaPipe Hands** to extract 21 3D landmark points per hand in real-time from your webcam feed.
2. **Gesture Classification:** Uses geometric landmark relationships to determine hand poses without needing complex heavy machine learning models.
3. **Canvas Transformations:** In Move Mode, tracks the midpoint and relative distance between both index fingertips to apply real-time pan and zoom offsets to the drawn paths.

---

## Live:

You can try the project directly: 
`https://charveeee.github.io/Air-Drawing-Recognition/`

*(Requires a webcam and camera permissions enabled in your browser)*

---

## Local Setup

If you prefer running the Python version locally:

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/charveeee/Air-Drawing-Recognition.git](https://github.com/charveeee/Air-Drawing-Recognition.git)
   cd Air-Drawing-Recognition
