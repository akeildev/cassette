export function formatCourseList(courses) {
  if (courses.length === 0) {
    return 'No courses available';
  }

  const lines = ['## Available Courses\n'];
  courses.forEach(course => {
    lines.push(`- **${course.title}** (${course.slug})`);
    if (course.description) {
      lines.push(`  ${course.description}`);
    }
  });

  return lines.join('\n');
}

export function formatStepContent(step) {
  return `## ${step.title}\n\n${step.content}`;
}

export function formatProgress(stats) {
  const lines = [
    '## Course Progress',
    '',
    `Progress: ${stats.percentComplete}% (${stats.completedSteps}/${stats.totalSteps} steps)`,
    `Time spent: ${stats.timeSpent}`
  ];

  return lines.join('\n');
}