import { cleanResumeV2, RESUME_KINDS } from './resume-v2.mjs';

/** Ordered public content. Private provenance and edit metadata are forbidden. */
export function cleanResumeV3(raw) {
  const fail = () => { throw new Error('简历展示内容无效。'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).sort().join(',') !== 'sections,version'
      || raw.version !== 'resume-v3' || !Array.isArray(raw.sections)) fail();
  const seenKinds = new Set(), seenOrders = new Set();
  const stripped = [];
  for (const section of raw.sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)
        || Object.keys(section).sort().join(',') !== 'items,kind,order'
        || !RESUME_KINDS.includes(section.kind)
        || !Number.isInteger(section.order) || section.order < 0 || section.order > 9
        || seenKinds.has(section.kind) || seenOrders.has(section.order)
        || !Array.isArray(section.items)) fail();
    seenKinds.add(section.kind); seenOrders.add(section.order);
    const orders = new Set();
    const items = section.items.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)
          || !Number.isInteger(item.order) || item.order < 0 || item.order >= section.items.length
          || orders.has(item.order)) fail();
      orders.add(item.order);
      const { order: _order, ...content } = item;
      return content;
    });
    stripped.push({kind:section.kind,items});
  }
  const clean = cleanResumeV2({version:'resume-v2',
    sections:[...stripped].sort((a,b)=>RESUME_KINDS.indexOf(a.kind)-RESUME_KINDS.indexOf(b.kind))});
  const byKind = new Map(clean.sections.map(section=>[section.kind,section]));
  return {version:'resume-v3', sections:[...raw.sections].sort((a,b)=>a.order-b.order).map(section=>({
    kind:section.kind, order:section.order,
    items:section.items.map((item,index)=>({...byKind.get(section.kind).items[index],order:item.order}))
      .sort((a,b)=>a.order-b.order)
  }))};
}
