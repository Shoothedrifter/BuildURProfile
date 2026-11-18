import App from "../../../App";

export default async function StylePage({ params }: { params: Promise<{ resumeId: string }> }) {
  const { resumeId } = await params;
  return <App initialPhase="quiz" styleResumeId={resumeId} />;
}
