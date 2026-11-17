// Opens the design system gallery at 390 x 844 in the theme of the project
// (light or dark) and checks errors, sideways scroll, tap targets, input text
// size, the accent bar, the sheet, toasts, focus and reduced motion.
import { expect, type Page, test } from '@playwright/test';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      errors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function open(page: Page, theme: string) {
  await page.goto(`/gallery.html?theme=${theme}`);
  await expect(page.getByRole('heading', { name: 'Design system', level: 1 })).toBeVisible();
}

async function noSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth, bodyWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  expect(bodyWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe('design system gallery', () => {
  test('renders every component in the theme with no console error and no sideways scroll', async ({
    page,
  }, info) => {
    const theme = info.project.name;
    const errors = watchErrors(page);
    await open(page, theme);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);

    // Page background follows the theme tokens.
    const bg = await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    expect(bg).toBe(theme === 'dark' ? 'rgb(17, 17, 19)' : 'rgb(246, 246, 244)');

    // Both theme blocks, each with every component section.
    for (const block of ['light', 'dark']) {
      const b = page.getByTestId(`block-${block}`);
      for (const name of [
        'Case colours',
        'Button',
        'Input',
        'AccentBar',
        'AnswerInput',
        'TokenText',
        'Sheet',
        'Card',
        'Tabs',
        'Toast',
        'ProgressRing',
        'EmptyState',
        'Skeleton',
      ]) {
        await expect(b.getByRole('heading', { name, exact: true })).toBeVisible();
      }
    }
    await noSidewaysScroll(page);
    expect(errors).toEqual([]);
  });

  test('tap targets are 44 px and field text is 16 px or more', async ({ page }, info) => {
    await open(page, info.project.name);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const els = document.querySelectorAll<HTMLElement>(
        'button, a[href], input, [role="tab"], textarea, select',
      );
      for (const el of els) {
        if (el.closest('[aria-hidden="true"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (el.hasAttribute('data-token')) {
          // Word buttons in running text get their height from an invisible ::before.
          const h = Number.parseFloat(getComputedStyle(el, '::before').height);
          if (h < 44) out.push(`token ${el.textContent}: ${h}`);
          continue;
        }
        if (r.height < 44 || r.width < 44)
          out.push(
            `${el.tagName} "${el.textContent?.trim() || el.getAttribute('aria-label') || ''}": ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
      }
      for (const el of document.querySelectorAll<HTMLInputElement>('input, textarea')) {
        const fs = Number.parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) out.push(`input ${el.id}: font ${fs}px`);
      }
      return out;
    });
    expect(small).toEqual([]);
  });

  test('answer fields are Slovak, without autocorrect, and the accent bar keeps the focus', async ({
    page,
  }, info) => {
    const errors = watchErrors(page);
    await open(page, info.project.name);
    const block = page.getByTestId(`block-${info.project.name}`);
    const field = block.getByTestId('answer-demo');
    await expect(field).toHaveAttribute('lang', 'sk');
    await expect(field).toHaveAttribute('autocorrect', 'off');
    await expect(field).toHaveAttribute('autocapitalize', 'none');
    await expect(field).toHaveAttribute('spellcheck', 'false');

    await field.fill('mest');
    await field.evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4));
    const bar = field.locator('xpath=ancestor::div[@data-state][1]').getByRole('toolbar');
    await bar.getByRole('button', { name: 'á', exact: true }).click();
    await expect(field).toHaveValue('mestá');
    expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
    // Insert in the middle.
    await field.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 1));
    await bar.getByRole('button', { name: 'é', exact: true }).tap();
    await expect(field).toHaveValue('méestá');
    expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await field.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(2);

    // States: wrong, close, correct.
    await field.fill('meste');
    await field.press('Enter');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await field.fill('mestá');
    await field.press('Enter');
    const wrapper = field.locator('xpath=ancestor::div[@data-state][1]');
    await expect(wrapper).toHaveAttribute('data-state', 'close');
    await expect(wrapper.getByRole('status')).toContainText('Almost');
    await field.fill('mesta');
    await field.press('Enter');
    await expect(wrapper).toHaveAttribute('data-state', 'correct');
    await noSidewaysScroll(page);
    expect(errors).toEqual([]);
  });

  test('the sheet opens at the bottom edge, closes with Escape and returns focus', async ({
    page,
  }, info) => {
    const errors = watchErrors(page);
    await open(page, info.project.name);
    const block = page.getByTestId(`block-${info.project.name}`);
    const trigger = block.getByRole('button', { name: 'Open sheet' });
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: 'mesto' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeVisible();
    // Sits on the bottom edge once the slide-in animation ends.
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return box && Math.round(box.y + box.height);
      })
      .toBe(844);
    await noSidewaysScroll(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('toasts appear and close', async ({ page }, info) => {
    const errors = watchErrors(page);
    await open(page, info.project.name);
    const block = page.getByTestId(`block-${info.project.name}`);
    await block.getByRole('button', { name: 'Error toast' }).click();
    const region = page.getByRole('region', { name: /Notifications/ });
    await expect(region.getByText('You are offline')).toBeVisible();
    await noSidewaysScroll(page);
    await region.getByRole('button', { name: 'Close' }).click();
    await expect(region.getByText('You are offline')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('focus is visible on keyboard navigation', async ({ page }, info) => {
    await open(page, info.project.name);
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth) };
    });
    expect(outline.style).toBe('solid');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test('tabs and words move with the arrow keys', async ({ page }, info) => {
    await open(page, info.project.name);
    const block = page.getByTestId(`block-${info.project.name}`);
    await block.getByRole('tab', { name: 'Singular' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(block.getByRole('tab', { name: 'Plural' })).toBeFocused();
    await expect(block.getByRole('tabpanel')).toContainText('mestá');

    const words = block.locator('[data-token]');
    await words.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(words.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(block.getByText('Last tapped: idem')).toBeVisible();
  });

  test('reduced motion stops the skeleton pulse', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, info.project.name);
    const name = await page
      .locator('[data-skeleton]')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('none');
  });
});
