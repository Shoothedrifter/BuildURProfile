import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { DesignConfig, MarqueeItem, ResumeContent } from "../../../../packages/contracts/src/config";
import { interactionIntensity, withInteractionIntensity } from "../lib/interaction";
import { projectPresentation } from "../lib/presentation";

type Update = (current: DesignConfig) => DesignConfig;
type Props = { config: DesignConfig; onChange: (update: Update) => void; isTouch: boolean };
type ProfileKey = keyof ResumeContent["profile"];
type ExpertiseKey = "eyebrow" | "headline" | "summary";
type ProjectKey = "index" | "title" | "category" | "year" | "description" | "tags" | "link";
type ListKey = "workExperience" | "campusExperience" | "education";

function withoutSourceRef(content: ResumeContent, key: string): ResumeContent {
  if (!content.sourceRefs?.[key]) return content;
  const sourceRefs = { ...content.sourceRefs };
  delete sourceRefs[key];
  return { ...content, sourceRefs };
}

function marqueeItems(config: DesignConfig): readonly MarqueeItem[] {
  return config.marquee.items ?? config.content.expertise.skills;
}

function itemLabel(item: MarqueeItem): string {
  return typeof item === "string" ? item : item.label;
}

async function imageDataUrl(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("图片仅支持 PNG、JPEG 或 WebP 格式。");
  }
  if (file.size > 12_000_000) throw new Error("图片过大，请选择小于 12 MB 的文件。");
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
  if (file.size < 600_000 || typeof createImageBitmap === "undefined") return original;
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return original;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const compact = canvas.toDataURL("image/webp", 0.82);
    return compact.length < original.length ? compact : original;
  } catch {
    return original;
  }
}

function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return <label className="editor-field"><span>{label}</span>{multiline
    ? <textarea value={value} rows={3} onChange={(event) => onChange(event.currentTarget.value)} />
    : <input value={value} onChange={(event) => onChange(event.currentTarget.value)} />}</label>;
}

function PanelGroup({ title, children }: { title: string; children: ReactNode }) {
  return <details className="editor-group" open><summary>{title}<span aria-hidden="true">＋</span></summary><div className="editor-group-body">{children}</div></details>;
}

export function EditorPanel({ config, onChange, isTouch }: Props) {
  const [imageError, setImageError] = useState("");
  const items = marqueeItems(config);
  const editProfile = (key: ProfileKey, value: string) => onChange((current) => ({
    ...current, content: { ...withoutSourceRef(current.content, "profile." + key), profile: { ...current.content.profile, [key]: value } }
  }));
  const editExpertise = (key: ExpertiseKey, value: string) => onChange((current) => ({
    ...current, content: { ...withoutSourceRef(current.content, "expertise." + key), expertise: { ...current.content.expertise, [key]: value } }
  }));
  const editExpertiseList = (key: "skills" | "disciplines", index: number, value: string) => onChange((current) => {
    const next = [...current.content.expertise[key]];
    next[index] = value;
    const content = withoutSourceRef(current.content, key + "." + index);
    return { ...current, content: { ...content, expertise: { ...current.content.expertise, [key]: next } } };
  });
  const editList = (key: ListKey, index: number, value: string) => onChange((current) => {
    const next = [...(current.content[key] ?? [])];
    next[index] = value;
    const content = withoutSourceRef(current.content, key + "." + index);
    return { ...current, content: { ...content, [key]: next } };
  });
  const editProject = (index: number, key: ProjectKey, value: string) => onChange((current) => {
    const projects = current.content.projects.map((project, projectIndex) => projectIndex === index
      ? { ...project, ...projectPresentation(project), [key]: key === "tags" ? value.split(",").map((tag) => tag.trim()).filter(Boolean) : value }
      : project);
    return { ...current, content: { ...withoutSourceRef(current.content, "projects." + index), projects } };
  });
  const editMarqueeLabel = (index: number, value: string) => onChange((current) => {
    const next = [...marqueeItems(current)];
    const previous = next[index];
    next[index] = typeof previous === "string" ? value : { ...previous, label: value };
    return { ...current, marquee: { ...current.marquee, items: next } };
  });
  const upload = async (event: ChangeEvent<HTMLInputElement>, apply: (current: DesignConfig, url: string) => DesignConfig) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    event.currentTarget.value = "";
    setImageError("");
    try {
      const url = await imageDataUrl(file);
      if (url.length > 4_000_000) throw new Error("处理后的图片仍过大，请选择更小的图片。");
      onChange((current) => apply(current, url));
    } catch (cause) {
      setImageError(cause instanceof Error ? cause.message : "图片读取失败，请重试。");
    }
  };
  const uploadMarquee = (event: ChangeEvent<HTMLInputElement>, index: number) => upload(event, (current, image) => {
    const next = [...marqueeItems(current)];
    next[index] = { label: itemLabel(next[index]), image };
    return { ...current, marquee: { ...current.marquee, items: next } };
  });
  const uploadProject = (event: ChangeEvent<HTMLInputElement>, index: number) => upload(event, (current, image) => ({
    ...current, content: { ...current.content, projects: current.content.projects.map((project, projectIndex) => projectIndex === index ? { ...project, image } : project) }
  }));
  return <aside className="editor-panel" aria-label="编辑面板">
    <div className="editor-heading"><span>LIVE EDITOR / 01</span><h2>编辑你的展示</h2><p>修改后实时更新预览；导出的配置和网站使用同一份内容。</p></div>
    <div className="editor-intensity"><div><label htmlFor="interaction-intensity">交互强度</label><output htmlFor="interaction-intensity">{interactionIntensity(config)}%</output></div><input id="interaction-intensity" type="range" min="0" max="100" step="1" value={interactionIntensity(config)} onChange={(event) => { const value = Number(event.currentTarget.value) / 100; onChange((current) => withInteractionIntensity(current, value, isTouch)); }} /><small>K / S 同步调整 · 当前跑马灯 {config.marquee.speed} px/s · 卡片缩放 {config.stackedCards.scaleStep}</small>{isTouch && <small>触屏设备使用卡片手动切换与跑马灯恒定滚动。</small>}</div>
    <PanelGroup title="个人信息与介绍">
      <TextField label="展示姓名" value={config.content.profile.name} onChange={(value) => editProfile("name", value)} />
      <TextField label="展示方向" value={config.content.profile.role} onChange={(value) => editProfile("role", value)} />
      <TextField label="地点" value={config.content.profile.location} onChange={(value) => editProfile("location", value)} />
      <TextField label="合作状态" value={config.content.profile.availability} onChange={(value) => editProfile("availability", value)} />
      <TextField label="开场文案" value={config.content.profile.intro} onChange={(value) => editProfile("intro", value)} multiline />
      <TextField label="个人摘要" value={config.content.profile.summary} onChange={(value) => editProfile("summary", value)} multiline />
      <TextField label="联系邮箱" value={config.content.profile.email} onChange={(value) => editProfile("email", value)} />
    </PanelGroup>
    <PanelGroup title="技能与专长">
      <TextField label="专长眉题" value={config.content.expertise.eyebrow} onChange={(value) => editExpertise("eyebrow", value)} />
      <TextField label="专长标题" value={config.content.expertise.headline} onChange={(value) => editExpertise("headline", value)} />
      <TextField label="专长摘要" value={config.content.expertise.summary} onChange={(value) => editExpertise("summary", value)} multiline />
      {config.content.expertise.skills.map((skill, index) => <TextField key={"skill-" + index} label={"技能 " + (index + 1)} value={skill} onChange={(value) => editExpertiseList("skills", index, value)} />)}
      {config.content.expertise.disciplines.map((discipline, index) => <TextField key={"discipline-" + index} label={"领域 " + (index + 1)} value={discipline} onChange={(value) => editExpertiseList("disciplines", index, value)} />)}
    </PanelGroup>
    <PanelGroup title="跑马灯文案与图片">
      <p className="editor-hint">完整技能说明始终显示在静态列表。跑马灯仅显示简短标签，可在这里增删。</p>
      {items.map((item, index) => <div className="editor-item" key={"marquee-" + index}>
        <TextField label={"跑马灯 " + (index + 1) + " 文案"} value={itemLabel(item)} onChange={(value) => editMarqueeLabel(index, value)} />
        {typeof item !== "string" && item.image && <img className="editor-thumb" src={item.image} alt={item.label + " 预览"} />}
        <label className="editor-upload"><span>{"跑马灯 " + (index + 1) + " 图片"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadMarquee(event, index)} /></label>
        {typeof item !== "string" && <button type="button" className="editor-remove" onClick={() => onChange((current) => { const next = [...marqueeItems(current)]; next[index] = itemLabel(next[index]); return { ...current, marquee: { ...current.marquee, items: next } }; })}>移除图片</button>}
      </div>)}
      <button type="button" className="editor-add" onClick={() => onChange((current) => ({ ...current, marquee: { ...current.marquee, items: [...marqueeItems(current), "新条目"] } }))}>＋ 添加跑马灯条目</button>
    </PanelGroup>
    <PanelGroup title="项目卡片">
      {config.content.projects.map((project, index) => <div className="editor-item" key={project.id}>
        <h3>{project.index} / {project.title}</h3>
        <TextField label={"项目 " + (index + 1) + " 序号"} value={project.index} onChange={(value) => editProject(index, "index", value)} />
        <TextField label={"项目 " + (index + 1) + " 标题"} value={project.title} onChange={(value) => editProject(index, "title", value)} />
        <TextField label={"项目 " + (index + 1) + " 分类"} value={projectPresentation(project).category} onChange={(value) => editProject(index, "category", value)} />
        <TextField label={"项目 " + (index + 1) + " 链接（仅 http/https）"} value={projectPresentation(project).link ?? ""} onChange={(value) => editProject(index, "link", value)} />
        <TextField label={"项目 " + (index + 1) + " 年份"} value={project.year} onChange={(value) => editProject(index, "year", value)} />
        <TextField label={"项目 " + (index + 1) + " 描述"} value={project.description} onChange={(value) => editProject(index, "description", value)} multiline />
        <TextField label={"项目 " + (index + 1) + " 标签"} value={project.tags.join(", ")} onChange={(value) => editProject(index, "tags", value)} />
        {project.image && <img className="editor-thumb" src={project.image} alt={project.title + " 封面预览"} />}
        <label className="editor-upload"><span>{"项目 " + (index + 1) + " 图片"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadProject(event, index)} /></label>
        {project.image && <button type="button" className="editor-remove" onClick={() => onChange((current) => ({ ...current, content: { ...current.content, projects: current.content.projects.map((entry, entryIndex) => entryIndex === index ? { ...entry, image: undefined } : entry) } }))}>移除图片</button>}
      </div>)}
    </PanelGroup>
    <PanelGroup title="经历与教育">
      {(["workExperience", "campusExperience", "education"] as const).map((key) => (config.content[key] ?? []).map((entry, index) => <TextField key={key + "-" + index} label={(key === "workExperience" ? "工作经历" : key === "campusExperience" ? "校园经历" : "教育") + " " + (index + 1)} value={entry} onChange={(value) => editList(key, index, value)} multiline />))}
    </PanelGroup>
    {imageError && <p className="editor-error" role="alert">{imageError}</p>}
  </aside>;
}
