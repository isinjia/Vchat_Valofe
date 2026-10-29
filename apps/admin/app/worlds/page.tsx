"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface WorldRow {
  id: number;
  name: string;
  description: string;
  is_active: number;
  character_count: number;
}

export default function WorldsPage() {
  const [worlds, setWorlds] = useState<WorldRow[]>([]);
  const [name, setName] = useState("");

  const load = () =>
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds);

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    await fetch("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setName("");
    load();
  };

  const remove = async (id: number) => {
    if (!confirm("세계관을 삭제하면 소속 캐릭터와 사전도 함께 삭제됩니다. 계속할까요?")) return;
    await fetch(`/api/worlds/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <h2>세계관 관리</h2>
      <div className="panel">
        <label>새 세계관 이름</label>
        <div className="row">
          <div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 아르카디아 대륙" />
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <button style={{ marginTop: 0 }} onClick={create}>추가</button>
          </div>
        </div>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr><th>ID</th><th>이름</th><th>설명</th><th>캐릭터 수</th><th>상태</th><th></th></tr>
          </thead>
          <tbody>
            {worlds.map((w) => (
              <tr key={w.id}>
                <td>{w.id}</td>
                <td><Link href={`/worlds/${w.id}`}>{w.name}</Link></td>
                <td className="muted">{w.description.slice(0, 60)}</td>
                <td>{w.character_count}</td>
                <td>{w.is_active ? "활성" : "비활성"}</td>
                <td><button className="danger small" onClick={() => remove(w.id)}>삭제</button></td>
              </tr>
            ))}
            {worlds.length === 0 && (
              <tr><td colSpan={6} className="muted">등록된 세계관이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
