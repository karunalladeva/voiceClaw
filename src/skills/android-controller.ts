import { BaseSkill, SkillDefinition } from './base-skill';
import { allAdbTools } from '../tools/android';

export default class AndroidControllerSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: 'android-controller',
      name: 'Android Controller',
      description: 'Controls Android devices via ADB - tap, swipe, type, open apps, take screenshots, and more.',
      triggerDescription:
        'Use when the user asks to control their phone, open an app on the phone, ' +
        'tap something on the phone, type on the phone, take a phone screenshot, ' +
        'swipe on the phone, press buttons on the phone, list installed apps, ' +
        'or perform any Android device operation.',
      systemPrompt:
        'You are an Android device controller. You can control the user\'s Android phone via ADB. ' +
        'You have tools to: list connected devices, run shell commands, tap coordinates, swipe, ' +
        'type text, send key events, open apps, list apps, take screenshots, and get screen info.\n\n' +
        'WORKFLOW for interacting with the phone:\n' +
        '1. First use adb_list_devices to confirm a device is connected.\n' +
        '2. Use adb_screen_info to know the resolution and current app.\n' +
        '3. Use adb_open_app to launch apps by package name.\n' +
        '4. Use adb_tap/adb_swipe/adb_input_text for UI interactions.\n' +
        '5. Use adb_screenshot to see what\'s on screen if needed.\n\n' +
        'Common package names: com.whatsapp, com.android.chrome, com.google.android.youtube, ' +
        'com.android.settings, com.android.camera, com.google.android.apps.maps.\n\n' +
        'Common key events: HOME=3, BACK=4, POWER=26, ENTER=66, VOLUME_UP=24, VOLUME_DOWN=25.\n\n' +
        'Your response will be spoken aloud, so keep it brief and natural.',
      tools: allAdbTools,
      enabled: true,
    };
  }
}
