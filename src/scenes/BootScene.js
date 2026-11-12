import Phaser from 'phaser';

// Загрузка всех сгенерированных ассетов из assets/ui.
// Ключи текстур совпадают с именами файлов в манифесте spritecook-assets.json.

const SFX = [
    'pickaxe_1', 'pickaxe_2', 'crit_1', 'crit_2',
    'break_1', 'break_2', 'mutation_1', 'mutation_2',
    'purchase_1', 'purchase_2', 'tier_1', 'tier_2', 'prestige_1', 'prestige_2'
];

const IMAGES = [
    // Блоки: уголь (старый каменный) + 11 тиров, каждый — 4 стадии повреждения
    'block_stage_1_intact', 'block_stage_2_cracked', 'block_stage_3_heavy_cracks', 'block_stage_4_shattered',
    'copper_stage_1', 'copper_stage_2', 'copper_stage_3', 'copper_stage_4',
    'iron_stage_1', 'iron_stage_2', 'iron_stage_3', 'iron_stage_4',
    'silver_stage_1', 'silver_stage_2', 'silver_stage_3', 'silver_stage_4',
    'gold_stage_1', 'gold_stage_2', 'gold_stage_3', 'gold_stage_4',
    'amethyst_stage_1', 'amethyst_stage_2', 'amethyst_stage_3', 'amethyst_stage_4',
    'emerald_stage_1', 'emerald_stage_2', 'emerald_stage_3', 'emerald_stage_4',
    'ruby_stage_1', 'ruby_stage_2', 'ruby_stage_3', 'ruby_stage_4',
    'sapphire_stage_1', 'sapphire_stage_2', 'sapphire_stage_3', 'sapphire_stage_4',
    'platinum_stage_1', 'platinum_stage_2', 'platinum_stage_3', 'platinum_stage_4',
    'uranium_stage_1', 'uranium_stage_2', 'uranium_stage_3', 'uranium_stage_4',
    'diamond_stage_1', 'diamond_stage_2', 'diamond_stage_3', 'diamond_stage_4',
    'ore_particle_debris',

    // Иконки руд (частицы + HUD)
    'coal_nugget', 'copper_nugget', 'iron_nugget', 'silver_nugget', 'gold_nugget',
    'amethyst_nugget', 'emerald_nugget', 'ruby_nugget', 'sapphire_nugget',
    'platinum_nugget', 'uranium_nugget', 'diamond_nugget',

    // Иконки улучшений
    'pickaxe_wooden', 'pickaxe_stone', 'pickaxe_iron', 'pickaxe_diamond',
    'icon_hammer', 'dynamite_bundle', 'icon_vein', 'hand_cursor',
    'miner_portrait', 'icon_drill', 'icon_excavator', 'icon_factory', 'gear_icon',
    'icon_robot_arm', 'icon_lantern', 'icon_warehouse',
    'icon_hydraulic', 'icon_plasma', 'icon_disintegrator',
    'icon_quarry', 'icon_megafactory', 'icon_orbital', 'icon_quantumlab',
    'icon_wormhole', 'icon_singularity', 'icon_dyson', 'icon_aicore',
    'icon_focuslens', 'icon_magnet',

    // Кнопки (чистые, подписи рендерим движком)
    'buy_button_normal', 'buy_button_hover', 'buy_button_pressed', 'buy_button_disabled_gray',
    'close_button_square', 'settings_button_wide',

    // Панели
    'hud_bar_background', 'upgrades_panel_wood', 'modal_panel_metal',
    'upgrade_row_card_1', 'icon_slot_frame',

    // Фоны локаций (пиксель-арт конверсия voxel-рендеров ComfyUI, по одному на тир)
    'bg_01_coal', 'bg_02_copper', 'bg_03_iron', 'bg_04_silver',
    'bg_05_gold', 'bg_06_amethyst', 'bg_07_emerald', 'bg_08_ruby',
    'bg_09_sapphire', 'bg_10_platinum', 'bg_11_uranium', 'bg_12_diamond'
];

export class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        for (const key of IMAGES) {
            this.load.image(key, `assets/ui/${key}.png`);
        }
        for (const key of SFX) {
            // Два формата: Safari/iOS не декодирует Ogg Vorbis — Phaser выберет первый playable
            this.load.audio(key, [`assets/audio/${key}.ogg`, `assets/audio/${key}.mp3`]);
        }
        // Фоновая музыка — бесшовный луп, те же два формата
        this.load.audio('bgm', ['assets/audio/bgm.ogg', 'assets/audio/bgm.mp3']);
    }

    create() {
        this.scene.start('GameScene');
    }
}

