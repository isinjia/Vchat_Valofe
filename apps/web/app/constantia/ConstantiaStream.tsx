"use client";

import { useEffect, useRef, useState } from "react";
import { onChatEvent, type ChatEvent } from "@/lib/chat-events";
import { AutoActor } from "../haru/auto-actor";
import { loadLao2D, type Lao2DRig } from "../lao2d/rig";

/** 모델마다 표정 부품 이름 규칙 (부품 노드 이름 → 번호) */
export interface Lao2DFaceMap {
  eye: RegExp; // 눈 부품 (캡처 1 = 번호)
  mouth: RegExp; // 입 부품
  mouthGroup: string; // 입 부품들의 부모 (말할 때 세로로 늘였다 줄임)
  head: string; // 고개 뼈
  body: string; // 몸통 뼈
  eyeOpen: string; eyeClosed: string; eyeSmile: string;
  mouthClosed: string; mouthOpen: string;
}

const FACE_MAPS: Record<string, Lao2DFaceMap> = {
  blacklilith: {
    eye: /^BL_parts_eye_[lLrR]_(\d)$/, mouth: /^BL_parts_mouse_(\d)$/, mouthGroup: "mouse", head: "head", body: "body",
    eyeOpen: "1", eyeClosed: "2", eyeSmile: "3", mouthClosed: "1", mouthOpen: "2",
  },
  constantia: {
    eye: /^CS_parts_eye_[lr]_(\d)$/, mouth: /^CS_parts_mouse_(\d)$/, mouthGroup: "mouse", head: "head", body: "body",
    eyeOpen: "1", eyeClosed: "2", eyeSmile: "3", mouthClosed: "1", mouthOpen: "2",
  },
};

/**
 * 라스트오리진 2D 방송 화면 — 게임 로비 일러스트 모델(부품 + 뼈)을 재생하고, 하루와 같은 자동 연기(AutoActor)로
 * 채팅 답변에 맞춰 입을 열고 닫고, 눈을 깜빡이고, 고개를 살짝 기울인다 (modelId: public/lao2d/<id>.json).
 */
export default function ConstantiaStream({ modelId = "constantia", title = "" }: { modelId?: string; title?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("방송 준비 중…");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const THREE = await import("three");
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
      camera.position.z = 50;
      const rig: Lao2DRig = await loadLao2D(THREE, "/lao2d", modelId);
      if (disposed) return;
      scene.add(rig.group);
      // 방송 구도: 머리 부품을 기준으로 머리부터 가슴 아래까지 (버튜버 상반신)
      const view = { ...rig.data.view };
      rig.resetPose();
      rig.applyClip("pose", 0);
      rig.update();
      const headMesh = rig.group.children.find((m) => /_parts_head$/i.test(m.name)) as import("three").Mesh | undefined;
      if (headMesh) {
        headMesh.geometry.computeBoundingBox();
        const hb = headMesh.geometry.boundingBox!;
        const hh = hb.max.y - hb.min.y;
        view.cx = (hb.min.x + hb.max.x) / 2;
        view.half = hh * 1.55;
        view.cy = hb.max.y + hh * 0.25 - view.half;
      }
      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        const half = view.half;
        const asp = w / h;
        camera.left = view.cx - half * asp;
        camera.right = view.cx + half * asp;
        camera.top = view.cy + half;
        camera.bottom = view.cy - half;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      // 머리카락·가슴: 로비 동작 클립에 이미 흔들림이 들어 있다. 덧붙인 용수철 흔들림(rig.addSpring)은
      // 머리카락이 춤추듯 과하게 움직여(사용자 지적) 쓰지 않는다
      // 게임이 실제로 트는 대기 동작: 로비(lobby) 반복. 없으면 idle
      const loopClip = rig.data.clips.lobby ? "lobby" : "idle";

      // ---------- 표정: 하루의 자동 연기 결과(FaceParams)를 2D 부품으로 옮긴다
      const fm = FACE_MAPS[modelId];
      const actor = new AutoActor();
      const nodes = rig.data.nodes;
      const eyeParts = fm ? nodes.map((n, i) => [i, n.n.match(fm.eye)?.[1]] as const).filter(([, k]) => k) : [];
      const mouthParts = fm ? nodes.map((n, i) => [i, n.n.match(fm.mouth)?.[1]] as const).filter(([, k]) => k) : [];
      const headBone = fm ? rig.node(fm.head) : -1;
      const bodyBone = fm ? rig.node(fm.body) : -1;
      const offChat = onChatEvent((ev: ChatEvent) => actor.onChatEvent(ev));

      setStatus("");
      const clock = new THREE.Clock();
      let t = 0;
      let raf = 0;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(0.1, clock.getDelta());
        t += dt;
        rig.resetPose();
        rig.applyClip(loopClip, t);
        if (fm) {
          const f = actor.update(dt);
          const blink = Math.max(f.blinkL, f.blinkR) > 0.55;
          const eye = blink ? (f.smile > 0.3 ? fm.eyeSmile : fm.eyeClosed) : fm.eyeOpen;
          for (const [i, k] of eyeParts) rig.show(i, k === eye);
          // 입: 벌림이 어느 정도 있으면 벌린 입 부품으로 바꾼다 (부품을 늘이면 기준점이 입 밖이라 입이 날아다님)
          const open = f.jaw > 0.12;
          for (const [i, k] of mouthParts) rig.show(i, k === (open ? fm.mouthOpen : fm.mouthClosed));
          // 고개·몸: 기울기만 (2D 그림이라 좌우로 돌리는 건 작게 기울이는 것으로 대신)
          rig.rotate(headBone, f.headRoll * 0.3 + f.headYaw * 0.08); // 로비 동작이 이미 고개를 움직여서 덧붙임은 작게
          rig.rotate(bodyBone, f.bodyRoll * 0.2);
        }
        rig.simulate(dt);
        rig.update();
        renderer.render(scene, camera);
      };
      tick();
      if (process.env.NODE_ENV !== "production") (window as unknown as { __lao?: unknown }).__lao = { THREE, rig, renderer, scene, camera, actor };
      cleanup = () => {
        cancelAnimationFrame(raf);
        offChat();
        ro.disconnect();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })().catch((e) => setStatus(`2D 오류: ${(e as Error).message}`));
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [modelId]);

  return (
    <div className="haru-stream lao-stream">
      <div ref={hostRef} className="haru-stream-canvas" />
      <div className="haru-stream-overlay">
        <span className="haru-live-badge">LIVE</span>
        {title && <span className="haru-stream-title">{title}</span>}
      </div>
      {status && <div className="haru-stream-status">{status}</div>}
    </div>
  );
}
