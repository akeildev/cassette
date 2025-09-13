export function formatCourseList(courses) {
  if (courses.length === 0) {
    return 'No courses available';
  }

  const lines = ['## Available Courses\n'];
  courses.forEach(course => {
    lines.push(`- **${course.title}**`);
    if (course.description) {
      lines.push(`  ${course.description}`);
    }
  });

  return lines.join('\n');
}

export function formatStepContent(step, platform = 'cassette', sessionData = {}) {
  // Build the content as a structured text with embedded JSON for parsing
  let contentParts = [];

  // Skip if step is for a different platform
  if (step.platform && step.platform !== platform && step.platform !== 'all') {
    return null;
  }

  // Replace placeholders in content with session data
  let content = step.lesson_content || '';
  for (const [key, value] of Object.entries(sessionData)) {
    content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  // Add the lesson content
  if (content) {
    contentParts.push(content);
  }

  // Add wait for response flag
  if (step.wait_for_user_response) {
    contentParts.push('\n[WAIT_FOR_RESPONSE]');
  }

  // Add action as structured data that the agent can parse
  if (step.action) {
    // Only include the essential fields for the action
    const actionData = {
      tool: step.action.tool,
      parameters: step.action.parameters
    };
    if (step.action.description) {
      actionData.description = step.action.description;
    }
    contentParts.push('\n\n[STEP_ACTION]' + JSON.stringify(actionData) + '[/STEP_ACTION]');
  }

  // Add fallback action if exists
  if (step.fallback_action) {
    contentParts.push('\n\n[FALLBACK_ACTION]' + JSON.stringify(step.fallback_action) + '[/FALLBACK_ACTION]');
  }

  // Add cursor action for cursor platform
  if (platform === 'cursor' && step.cursor_action) {
    contentParts.push('\n\n[CURSOR_ACTION]' + JSON.stringify(step.cursor_action) + '[/CURSOR_ACTION]');
  }

  // Add database save instruction
  if (step.action?.parameters?.save_to_database) {
    contentParts.push('\n\n[SAVE_TO_DATABASE]' + JSON.stringify(step.action.parameters.save_to_database) + '[/SAVE_TO_DATABASE]');
  }

  // Add stop marker if this step should stop the flow
  if (step.stop_here) {
    contentParts.push('\n\n[STOP_HERE]');
  }

  return contentParts.join('\n');
}

export function formatProgress(stats) {
  const lines = [
    '## Course Progress',
    '',
    `Progress: ${stats.percentComplete}% (${stats.completedSteps}/${stats.totalSteps} steps)`
  ];

  return lines.join('\n');
}