import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const { WIDGET_JS } = require('./widgetScript.js');
const { renderWidgetDemoPage } = require('./demoPage.js');

describe('widget rendering assets', () => {
  it('keeps the emitted browser bundle byte-for-byte stable', () => {
    const emitted = WIDGET_JS.trimStart();

    expect(Buffer.byteLength(emitted)).toBe(47673);
    expect(createHash('sha256').update(emitted).digest('hex')).toBe(
      '88fb9a6ee3b538030f0464e4804fda58bfb1b13c67ce361acdb1e0f559f622bf',
    );
  });

  it('retains the widget API origin, socket path, and public endpoints', () => {
    expect(WIDGET_JS).toContain("var API_BASE=API_ORIGIN+'/api';");
    expect(WIDGET_JS).toContain("path:'/api/socket.io'");
    expect(WIDGET_JS).toContain("API_BASE+'/widget/session'");
    expect(WIDGET_JS).toContain("API_BASE+'/widget/messages?");
    expect(WIDGET_JS).toContain("API_BASE+'/widget/message'");
  });

  it('renders the demo with the same embed configuration', () => {
    const page = renderWidgetDemoPage();

    expect(page).toContain('<title>OmniCore Widget Demo</title>');
    expect(page).toContain('src="/api/widget/widget.js"');
    expect(page).toContain(
      'data-brand-id="22222222-2222-2222-2222-222222222222"',
    );
    expect(page).toContain('data-color="#0284c7"');
  });
});
