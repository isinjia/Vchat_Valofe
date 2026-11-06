// 라스트오리진 2D 일러스트 모델(Character_2D/2DModel_*) → 웹용 JSON.
// 뼈(모든 Transform)의 기본 자세, 렌더러마다 메시·스킨·텍스처·그리는 순서, 애니메이션 클립을 프레임별로 뽑고
// 기준 그림(PNG)도 함께 찍는다.  실행: Unity -batchmode -executeMethod Lao2D.Run  (작업 목록: lao2d_jobs.txt)
// 작업 줄: id|prefab 경로|클립이름=클립경로;클립이름=클립경로...
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

public static class Lao2D
{
    static readonly CultureInfo ci = CultureInfo.InvariantCulture;
    const float FPS = 30f;

    public static void Run()
    {
        Directory.CreateDirectory("lao2d");
        foreach (var line in File.ReadAllLines("lao2d_jobs.txt"))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var p = line.Split('|');
            try { Export(p[0], p[1], p.Length > 2 ? p[2] : "", p.Length > 3 && p[3] == "ref"); }
            catch (System.Exception e) { Debug.LogError("LAO2D FAIL " + p[0] + " " + e); }
        }
        EditorApplication.Exit(0);
    }

    static void F(StringBuilder sb, float v) { sb.Append(v.ToString("0.#####", ci)); }
    static void Arr(StringBuilder sb, IEnumerable<float> vs) { sb.Append('['); bool f = true; foreach (var v in vs) { if (!f) sb.Append(','); f = false; F(sb, v); } sb.Append(']'); }
    static string Esc(string s) { return s.Replace("\\", "/").Replace("\"", "\\\""); }

    static void Export(string id, string prefabPath, string clipSpec, bool refOnly = false)
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
        var go = (GameObject)Object.Instantiate(prefab);
        go.transform.position = Vector3.zero;
        var animator = go.GetComponentInChildren<Animator>(true);
        var root = animator ? animator.gameObject : go;
        var clips = new List<KeyValuePair<string, AnimationClip>>();
        foreach (var part in clipSpec.Split(';'))
        {
            if (!part.Contains("=")) continue;
            var kv = part.Split('=');
            var c = AssetDatabase.LoadAssetAtPath<AnimationClip>(kv[1]);
            if (c) clips.Add(new KeyValuePair<string, AnimationClip>(kv[0], c));
        }
        // 기본 자세: pose 클립이 있으면 그것, 없으면 첫 클립의 0초
        var poseClip = clips.FirstOrDefault(c => c.Key == "pose").Value ?? (clips.Count > 0 ? clips[0].Value : null);
        if (poseClip) poseClip.SampleAnimation(root, 0);

        var all = go.GetComponentsInChildren<Transform>(true).ToList();
        var index = new Dictionary<Transform, int>();
        for (int i = 0; i < all.Count; i++) index[all[i]] = i;

        var sb = new StringBuilder("{\"id\":\"").Append(id).Append("\",\"nodes\":[");
        for (int i = 0; i < all.Count; i++)
        {
            var t = all[i];
            if (i > 0) sb.Append(',');
            sb.Append("{\"n\":\"").Append(Esc(t.name)).Append("\",\"p\":").Append(t.parent && index.ContainsKey(t.parent) ? index[t.parent] : -1)
              .Append(",\"on\":").Append(t.gameObject.activeSelf ? 1 : 0).Append(",\"t\":");
            Arr(sb, new[] { t.localPosition.x, t.localPosition.y, t.localPosition.z });
            sb.Append(",\"q\":"); Arr(sb, new[] { t.localRotation.x, t.localRotation.y, t.localRotation.z, t.localRotation.w });
            sb.Append(",\"s\":"); Arr(sb, new[] { t.localScale.x, t.localScale.y, t.localScale.z });
            sb.Append('}');
        }
        sb.Append("],\"parts\":[");
        bool first = true;
        foreach (var r in go.GetComponentsInChildren<Renderer>(true))
        {
            Mesh mesh = null; Vector2[] uv = null; int[] tris = null; Vector3[] verts = null;
            var smr = r as SkinnedMeshRenderer;
            var sr = r as SpriteRenderer;
            Texture tex = null; Color col = Color.white;
            var mat = r.sharedMaterial;
            if (sr)
            {
                if (!sr.sprite) continue;
                verts = sr.sprite.vertices.Select(v => (Vector3)v).ToArray();
                uv = sr.sprite.uv; tris = sr.sprite.triangles.Select(x => (int)x).ToArray();
                tex = sr.sprite.texture; col = sr.color;
            }
            else
            {
                if (smr) mesh = smr.sharedMesh;
                else { var mf = r.GetComponent<MeshFilter>(); mesh = mf ? mf.sharedMesh : null; }
                if (!mesh) continue;
                verts = mesh.vertices; uv = mesh.uv; tris = mesh.triangles;
                tex = mat && mat.HasProperty("_MainTex") ? mat.mainTexture : null;
                if (!tex && mat) foreach (var tn in mat.GetTexturePropertyNames()) if ((tex = mat.GetTexture(tn)) != null) break;
                col = mat && mat.HasProperty("_Color") ? mat.color : Color.white;
            }
            if (!first) sb.Append(','); first = false;
            sb.Append("{\"node\":").Append(index[r.transform])
              .Append(",\"kind\":\"").Append(smr ? "skin" : sr ? "sprite" : "mesh").Append('"')
              .Append(",\"on\":").Append(r.enabled ? 1 : 0)
              .Append(",\"layer\":").Append(SortingLayer.GetLayerValueFromID(r.sortingLayerID)).Append(",\"order\":").Append(r.sortingOrder)
              .Append(",\"tex\":\"").Append(tex ? Esc(AssetDatabase.GetAssetPath(tex)) : "").Append('"')
              .Append(",\"shader\":\"").Append(mat && mat.shader ? Esc(mat.shader.name) : "").Append('"')
              .Append(",\"color\":"); Arr(sb, new[] { col.r, col.g, col.b, col.a });
            sb.Append(",\"pos\":"); Arr(sb, verts.SelectMany(v => new[] { v.x, v.y, v.z }));
            sb.Append(",\"uv\":"); Arr(sb, Enumerable.Range(0, verts.Length).SelectMany(i => i < uv.Length ? new[] { uv[i].x, uv[i].y } : new[] { 0f, 0f }));
            sb.Append(",\"idx\":[").Append(string.Join(",", tris)).Append(']');
            if (smr && mesh.boneWeights.Length == verts.Length)
            {
                var bw = mesh.boneWeights; var bones = smr.bones; var bind = mesh.bindposes;
                sb.Append(",\"si\":[").Append(string.Join(",", bw.SelectMany(b => new[] { b.boneIndex0, b.boneIndex1, b.boneIndex2, b.boneIndex3 }))).Append(']');
                sb.Append(",\"sw\":"); Arr(sb, bw.SelectMany(b => new[] { b.weight0, b.weight1, b.weight2, b.weight3 }));
                sb.Append(",\"bones\":[").Append(string.Join(",", bones.Select(b => b && index.ContainsKey(b) ? index[b] : -1))).Append(']');
                sb.Append(",\"bind\":"); Arr(sb, bind.SelectMany(m => Enumerable.Range(0, 16).Select(k => m[k])));
            }
            sb.Append('}');
        }
        // 클립: 프레임마다 모든 Transform 의 로컬 자세와 켜짐, 렌더러 켜짐
        sb.Append("],\"clips\":{");
        var rends = go.GetComponentsInChildren<Renderer>(true).ToList();
        for (int c = 0; c < clips.Count; c++)
        {
            var clip = clips[c].Value;
            int frames = Mathf.Max(1, Mathf.RoundToInt(clip.length * FPS) + 1);
            if (c > 0) sb.Append(',');
            sb.Append('"').Append(clips[c].Key).Append("\":{\"len\":"); F(sb, clip.length);
            sb.Append(",\"loop\":").Append(clip.isLooping ? 1 : 0).Append(",\"fps\":"); F(sb, FPS);
            sb.Append(",\"frames\":[");
            for (int f = 0; f < frames; f++)
            {
                if (poseClip) poseClip.SampleAnimation(root, 0);
                clip.SampleAnimation(root, Mathf.Min(clip.length, f / FPS));
                if (f > 0) sb.Append(',');
                sb.Append("{\"t\":"); Arr(sb, all.SelectMany(t => new[] { t.localPosition.x, t.localPosition.y, t.localPosition.z }));
                sb.Append(",\"q\":"); Arr(sb, all.SelectMany(t => new[] { t.localRotation.x, t.localRotation.y, t.localRotation.z, t.localRotation.w }));
                sb.Append(",\"s\":"); Arr(sb, all.SelectMany(t => new[] { t.localScale.x, t.localScale.y, t.localScale.z }));
                sb.Append(",\"on\":[").Append(string.Join(",", all.Select(t => t.gameObject.activeSelf ? 1 : 0))).Append(']');
                sb.Append(",\"ren\":[").Append(string.Join(",", rends.Select(r => r.enabled ? 1 : 0))).Append("]}");
            }
            sb.Append("]}");
        }
        sb.Append("}}");
        if (!refOnly) File.WriteAllText("lao2d/" + id + ".json", sb.ToString()); // ref: 기준 그림만 (후보 훑어보기)

        // 기준 그림: pose 자세로 정사영 카메라 촬영
        if (poseClip) poseClip.SampleAnimation(root, 0);
        var b = new Bounds(); bool has = false;
        foreach (var r in go.GetComponentsInChildren<Renderer>(false))
        {
            if (!r.enabled || r is ParticleSystemRenderer) continue;
            if (r.bounds.extents.x > 50 || r.bounds.extents.y > 50) continue;
            if (has) b.Encapsulate(r.bounds); else { b = r.bounds; has = true; }
        }
        float half = Mathf.Max(b.extents.x, b.extents.y) * 1.05f;
        var camGo = new GameObject("cam");
        var cam = camGo.AddComponent<Camera>();
        cam.orthographic = true; cam.orthographicSize = half;
        cam.transform.position = new Vector3(b.center.x, b.center.y, -100);
        cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = new Color(0, 0, 0, 0);
        cam.nearClipPlane = 0.01f; cam.farClipPlane = 500;
        const int SIZE = 1024;
        var rt = new RenderTexture(SIZE, SIZE, 24, RenderTextureFormat.ARGB32);
        cam.targetTexture = rt; cam.Render();
        RenderTexture.active = rt;
        var img = new Texture2D(SIZE, SIZE, TextureFormat.RGBA32, false);
        img.ReadPixels(new Rect(0, 0, SIZE, SIZE), 0, 0); img.Apply();
        File.WriteAllBytes("lao2d/" + id + "_ref.png", img.EncodeToPNG());
        File.WriteAllText("lao2d/" + id + "_ref.json", "{\"cx\":" + b.center.x.ToString(ci) + ",\"cy\":" + b.center.y.ToString(ci) + ",\"half\":" + half.ToString(ci) + "}");
        RenderTexture.active = null;
        Object.DestroyImmediate(camGo);
        Object.DestroyImmediate(go);
        Debug.Log("LAO2D " + id + " nodes " + all.Count);
    }
}
