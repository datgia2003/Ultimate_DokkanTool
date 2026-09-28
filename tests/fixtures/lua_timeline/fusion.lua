--4022390:超サイヤ人ゴッドSS孫悟空＆超サイヤ人ゴッドSSベジータ_フュージョン

--sp_effect_a2_00173



fcolor_r = 245;

fcolor_g = 245;

fcolor_b = 245;



SE_01 = 1035; --気を貯める

SE_02 = 1036; --気が広がる

SE_03 = 1036; --かめはめ

SE_04 = 1018; --カットイン

SE_05 = 1035; --カットイン攻撃

SE_06 = 1021; --発射

SE_07 = 1022; --のびる発射

SE_08 = 1042; --カットイン

SE_09 = 1023; --HIT

SE_10 = 1024; --爆破

SE_11 = 1054; --割れる音

SE_12 = 09;



--エフェクト(味方)

SP_01 = 158990;  --フュージョンまで    ef_001

SP_02 = 158991;  --スターダストフォールまで    ef_002

SP_03 = 158992;  --スターダストブレイカーから最後まで   ef_003



------------------------------------------------------

-- テンプレ構文

------------------------------------------------------

multi_frm = 2;



setVisibleUI( 0, 0);



ENABLE_AUTO_TIME_STRETCH(0.8);





setDisp( 0, 0, 0);

changeAnime( 0, 0, 0);





setMoveKey(   0,   0,    0, -5000,   0);

setMoveKey(   1,   0,    0, -5000,   0);

setMoveKey(   2,   0,    0, -5000,   0);

setMoveKey(   3,   0,    0, -5000,   0);

setMoveKey(   4,   0,    0, -5000,   0);

setMoveKey(   5,   0,    0, -5000,   0);

setMoveKey(   6,   0,    0, -5000,   0);

setScaleKey(  0,   0,  1.6, 1.6 );

setScaleKey(  1,   0,  1.6, 1.6 );

setScaleKey(  2,   0,  1.6, 1.6 );

setScaleKey(  3,   0,  1.6, 1.6 );

setScaleKey(  4,   0,  1.6, 1.6 );

setScaleKey(  5,   0,  1.6, 1.6 );

setScaleKey(  6,   0,  1.6, 1.6 );

setRotateKey( 0,   0,  0 );

setRotateKey( 1,   0,  0 );

setRotateKey( 2,   0,  0 );

setRotateKey( 3,   0,  0 );

setRotateKey( 4,   0,  0 );

setRotateKey( 5,   0,  0 );

setRotateKey( 6,   0,  0 );



kame_flag = 0x00;

if (_IS_PLAYER_SIDE_ == 1) then

    

    if (_IS_SKIP_ == 1) then

        spep_0 = 0;

        spep_1=spep_0+370;

        spep_2=spep_1+516;

        spep_3=spep_2+440;

       if(_IS_DODGE_ == 1) then

           skipFrame(0, spep_1 + 370 -12);        -- スキップかつ回避された時のスキップ先フレーム指定

       else

           skipFrame(0, spep_2 + 292);      -- スキップ先フレーム指定

           SE066 = playSeVer2( spep_2 + 292, 1258, "", 0, 0, 0, -1);

           setSeVolumeByWorkId( spep_2 + 292, SE066, 58 );

           SE067 = playSeVer2( spep_2 + 292, 1067, "", 0, 0, 0, -1);

           SE068 = playSeVer2( spep_2 + 295, 1159, "", 0, 0, 0, -1);

           setSeVolumeByWorkId( spep_2 + 295, SE068, 97 );



       end

    else end

------------------------------------------------------------------------------------------------------------

-- 味方側

------------------------------------------------------------------------------------------------------------

------------------------------------------------------

-- フュージョンまで

------------------------------------------------------

--はじめの準備

spep_0=0;

-- ** エフェクト等 ** --

first = entryEffect( spep_0 + 0, SP_01, 0x100, -1, 0, 0, 0 ); --フュージョンまで    ef_001

setEffMoveKey( spep_0 + 0, first, 0, 0, 0 );

setEffMoveKey( spep_0 + 370, first, 0, 0, 0 );

setEffScaleKey( spep_0 + 0, first, 1.0, 1.0 );

setEffScaleKey( spep_0 + 370, first, 1.0, 1.0 );

setEffRotateKey( spep_0 + 0, first, 0 );

setEffRotateKey( spep_0 + 370, first, 0 );

setEffAlphaKey( spep_0 + 0, first, 255 );

setEffAlphaKey( spep_0 + 370, first, 255 );



--敵座標の固定

setDisp( 0, 1, 0);

changeAnime( 0, 1, 100);

setAlphaKey( 0, 1, 255 );



setMoveKey(   0,   1,    0, -5000,   0);

setMoveKey(   1,   1,    0, -5000,   0);

setMoveKey(   2,   1,    0, -5000,   0);

setMoveKey(   3,   1,    0, -5000,   0);

setMoveKey(   4,   1,    0, -5000,   0);

setMoveKey(   5,   1,    0, -5000,   0);

setMoveKey(   6,   1,    0, -5000,   0);



setScaleKey(  0,   1,  1.6, 1.6 );

setScaleKey(  1,   1,  1.6, 1.6 );

setScaleKey(  2,   1,  1.6, 1.6 );

setScaleKey(  3,   1,  1.6, 1.6 );

setScaleKey(  4,   1,  1.6, 1.6 );

setScaleKey(  5,   1,  1.6, 1.6 );

setScaleKey(  6,   1,  1.6, 1.6 );

setRotateKey( 0,   1,  0 );

setRotateKey( 1,   1,  0 );

setRotateKey( 2,   1,  0 );

setRotateKey( 3,   1,  0 );

setRotateKey( 4,   1,  0 );

setRotateKey( 5,   1,  0 );

setRotateKey( 6,   1,  0 );



--SE

--セリフカットイン

SE001 = playSeVer2( spep_0 + 0, 1018, "", 0, 0, 0, -1);



--構える

SE003 = playSeVer2( spep_0 + 70, 1333, "",spep_0 + 111, 8, 18, -1);

setSeVolumeByWorkId( spep_0 + 70, SE003, 108 );

setStartTimeMs( SE003,  417 );

SE004 = playSeVer2( spep_0 + 75, 1189, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 75, SE004, 211 );



--指合わせにいく

SE002 = playSeVer2( spep_0 + 110, 1266, "",spep_0 + 186, 7, 30, -1);

setStartTimeMs( SE002,  1967 );

SE005 = playSeVer2( spep_0 + 110, 1307, "",spep_0 + 186, 0, 30, -1);

setSeVolumeByWorkId( spep_0 + 110, SE005, 216 );

SE006 = playSeVer2( spep_0 + 111, 1117, "",spep_0 + 186, 0, 30, -1);



--指合わせる

SE007 = playSeVer2( spep_0 + 146, 1333, "",spep_0 + 171, 2, 13, -1);

setSeVolumeByWorkId( spep_0 + 146, SE007, 130 );

setStartTimeMs( SE007,  400 );

setBandpassFilter  ( spep_0 + 146, SE007, 289, 24000 );

SE008 = playSeVer2( spep_0 + 146, 1233, "",spep_0 + 161, 2, 6, -1);

setSeVolumeByWorkId( spep_0 + 146, SE008, 154 );

setStartTimeMs( SE008,  83 );

setPitch( spep_0 + 146, SE008, 300 );

setTimeStretch( SE008, 1.2, 30, 4 );

SE009 = playSeVer2( spep_0 + 147, 1189, "", 0, 6, 0, -1);

setSeVolumeByWorkId( spep_0 + 147, SE009, 168 );

SE010 = playSeVer2( spep_0 + 149, 1189, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 149, SE010, 260 );

setPitch( spep_0 + 149, SE010, 400 );

setTimeStretch( SE010, 1.27, 30, 4 );

setBandpassFilter  ( spep_0 + 149, SE010, 500, 24000 );



--炎包まれる

SE011 = playSeVer2( spep_0 + 199, 1176, "",spep_0 +362 + 38, 0, 49, -1);

setSeVolumeByWorkId( spep_0 + 199, SE011, 65 );

SE012 = playSeVer2( spep_0 + 199, 1252, "",spep_0 + 302, 0, 26, -1);

setSeVolumeByWorkId( spep_0 + 199, SE012, 79 );

SE013 = playSeVer2( spep_0 + 199, 1011, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 199, SE013, 61 );

SE014 = playSeVer2( spep_0 + 199, 1264, "",spep_0 +362 + 28, 0, 36, -1);

setSeVolumeByWorkId( spep_0 + 199, SE014, 79 );



--風巻き上がる

SE015 = playSeVer2( spep_0 + 271, 1321, "",spep_0 +366 + 12, 14, 46, -1);

setSeVolumeByWorkId( spep_0 + 271, SE015, 68 );

setStartTimeMs( SE015,  417 );

setPitch( spep_0 + 271, SE015, -200 );

setTimeStretch( SE015, 0.87, 30, 4 );

SE016 = playSeVer2( spep_0 + 251, 1212, "",spep_0 +366 + 39, 0, 47, -1);

setSeVolumeByWorkId( spep_0 + 251, SE016, 52 );

SE017 = playSeVer2( spep_0 + 254, 1051, "", 0, 0, 0, -1);

SE018 = playSeVer2( spep_0 + 257, 1258, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 257, SE018, 92 );

SE019 = playSeVer2( spep_0 + 283, 1259, "", 0, 0, 0, -1);



--ボイス

--フュー…

playVoice( spep_0 + 2, 282 );

setVoiceVolume( spep_0 + 2, 282, 100 );



--ジョン！

playVoice( spep_0 + 74, 283 );

setVoiceVolume( spep_0 + 74, 283, 100 );



--はっ！！

playVoice( spep_0 + 120, 394 );

setVoiceVolume( spep_0 + 120, 394, 100 );



-- ** 黒背景 ** --

entryFadeBg( spep_0 + 0, 0, 372, 0, 0, 0, 0, 255);       -- ベース暗め　背景



--次の準備

spep_1=spep_0+370;





------------------------------------------------------

-- スターダストフォールまで

------------------------------------------------------

--spep_1=0;

-- ** エフェクト等 ** --

sdf = entryEffect( spep_1 + 0, SP_02, 0x100, -1, 0, 0, 0 ); --スターダストフォールまで    ef_002

setEffMoveKey( spep_1 + 0, sdf, 0, 0, 0 );

setEffMoveKey( spep_1 + 516, sdf, 0, 0, 0 );

setEffScaleKey( spep_1 + 0, sdf, 1.0, 1.0 );

setEffScaleKey( spep_1 + 516, sdf, 1.0, 1.0 );

setEffRotateKey( spep_1 + 0, sdf, 0 );

setEffRotateKey( spep_1 + 516, sdf, 0 );

setEffAlphaKey( spep_1 + 0, sdf, 255 );

setEffAlphaKey( spep_1 + 514, sdf, 255 );

setEffAlphaKey( spep_1 + 515, sdf, 255 );

setEffAlphaKey( spep_1 + 516, sdf, 0 );



--SE

--変身完了

SE020 = playSeVer2( spep_1 + 22, 1212, "",spep_1 + 127, 14, 60, -1);

setSeVolumeByWorkId( spep_1 + 22, SE020, 56 );

setStartTimeMs( SE020,  633 );

SE021 = playSeVer2( spep_1 + 24, 1182, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_1 + 24, SE021, 65 );

SE022 = playSeVer2( spep_1 + 24, 1217, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_1 + 24, SE022, 73 );

SE023 = playSeVer2( spep_1 + 28, 1027, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_1 + 28, SE023, 71 );

setPitch( spep_1 + 28, SE023, -400 );

setTimeStretch( SE023, 0.73, 34, 4 );

SE024 = playSeVer2( spep_1 + 34, 1257, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_1 + 34, SE024, 114 );

setPitch( spep_1 + 34, SE024, 600 );

setTimeStretch( SE024, 1.4, 30, 4 );



--気ダメ

SE025 = playSeVer2( spep_1 + 117, 1035, "", 0, 0, 0, -1);

SE026 = playSeVer2( spep_1 + 117, 1024, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_1 + 117, SE026, 81 );



--顔アップ

SE027 = playSeVer2( spep_1 + 177, 1258, "",spep_1 + 345, 0, 104, -1);

setSeVolumeByWorkId( spep_1 + 177, SE027, 71 );

setBandpassFilter  ( spep_1 + 177, SE027, 24, 1600 );



--気弾ため

SE028 = playSeVer2( spep_1 + 245, 1360, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_1 + 245, SE028, 180 );



--腕合わせる

SE030 = playSeVer2( spep_1 + 326, 1006, "", 0, 0, 0, -1);



--ボイス

--へへ

playVoice( spep_1 + 34, 359 );

setVoiceVolume( spep_1 + 34, 359, 133 );



--いっちょ行くぜ！

playVoice( spep_1 + 89, 360 );

setVoiceVolume( spep_1 + 89, 360, 100 );



--でやぁぁああ！！(連射前気溜め)

playVoice( spep_1 + 177, 361 );

setVoiceVolume( spep_1 + 177, 361, 112 );



--------------------------------------

--回避

--------------------------------------



if(_IS_DODGE_ == 1) then



    SP_dodge = spep_1 + 370 ; --エンドフェイズのフレーム数を置き換える

    

    playSe( SP_dodge - 12, 1042);

    --stopSe( SP_dodge - 12, SE001, 0);

    --stopSe( SP_dodge - 12, SE020, 0);

    --stopSe( SP_dodge - 12, SE021, 0);

    --stopSe( SP_dodge - 12, SE022, 0);

    --stopSe( SP_dodge - 12, SE023, 0);

    --stopSe( SP_dodge - 12, SE024, 0);

   

    pauseAll( SP_dodge, 67);



    speff = entryEffectUnpausable( SP_dodge-12, 1504, 0x100, -1, 0, 0, -350); -- eff_005 (カットイン)

    setEffReplaceTexture( speff, 3, 6); -- カットイン差し替え

    

    kaihi = entryEffectUnpausable( SP_dodge, 1575, 0x100, -1, 0, 0, 350); -- 回避の文字表示

    --entryFadeBg( SP_dodge, 0, 90, 0,0, 0, 0, 180);          -- ベース暗め　背景

    

    entryFade(SP_dodge+5, 4, 7, 4, fcolor_r, fcolor_g, fcolor_b, 255); -- white fade

    endPhase(SP_dodge+10);

    

    do return end

    else end

--------------------------------------

--回避しなかった場合

--------------------------------------



-- ** 書き文字エントリー ** --

ctzudodo = entryEffectLife( spep_1 -3 + 426,  10014, 93, 0x100, -1, 0, 121.8, 227.9 );

setEffShake( spep_1 -3 + 426, ctzudodo, 93, 20 );

setEffMoveKey( spep_1 -3 + 426, ctzudodo, 121.8, 227.9 , 0 );

setEffMoveKey( spep_1 -3 + 428, ctzudodo, 123.6, 234 , 0 );

setEffMoveKey( spep_1 -3 + 430, ctzudodo, 116.4, 218.7 , 0 );

setEffMoveKey( spep_1 -3 + 432, ctzudodo, 132.1, 233.7 , 0 );

setEffMoveKey( spep_1 -3 + 434, ctzudodo, 120.2, 222.3 , 0 );

setEffMoveKey( spep_1 -3 + 436, ctzudodo, 116, 239 , 0 );

setEffMoveKey( spep_1 -3 + 438, ctzudodo, 122, 219 , 0 );

setEffMoveKey( spep_1 -3 + 440, ctzudodo, 128.6, 237.6 , 0 );

setEffMoveKey( spep_1 -3 + 442, ctzudodo, 118.4, 221.8 , 0 );

setEffMoveKey( spep_1 -3 + 444, ctzudodo, 134.2, 231.3 , 0 );

setEffMoveKey( spep_1 -3 + 446, ctzudodo, 115.2, 224.1 , 0 );

setEffMoveKey( spep_1 -3 + 448, ctzudodo, 125.7, 240.8 , 0 );

setEffMoveKey( spep_1 -3 + 450, ctzudodo, 117.2, 227.1 , 0 );

setEffMoveKey( spep_1 -3 + 452, ctzudodo, 127.3, 239.2 , 0 );

setEffMoveKey( spep_1 -3 + 454, ctzudodo, 122, 226.5 , 0 );

setEffMoveKey( spep_1 -3 + 456, ctzudodo, 129.8, 240.5 , 0 );

setEffMoveKey( spep_1 -3 + 458, ctzudodo, 117.3, 233 , 0 );

setEffMoveKey( spep_1 -3 + 460, ctzudodo, 133.7, 234.7 , 0 );

setEffMoveKey( spep_1 -3 + 462, ctzudodo, 116.9, 226.9 , 0 );

setEffMoveKey( spep_1 -3 + 464, ctzudodo, 128.3, 242.8 , 0 );

setEffMoveKey( spep_1 -3 + 466, ctzudodo, 126.7, 227.8 , 0 );

setEffMoveKey( spep_1 -3 + 468, ctzudodo, 133.1, 241 , 0 );

setEffMoveKey( spep_1 -3 + 470, ctzudodo, 116.7, 234.6 , 0 );

setEffMoveKey( spep_1 -3 + 472, ctzudodo, 129.6, 242.6 , 0 );

setEffMoveKey( spep_1 -3 + 474, ctzudodo, 121.1, 233.9 , 0 );

setEffMoveKey( spep_1 -3 + 476, ctzudodo, 127.5, 237 , 0 );

setEffMoveKey( spep_1 -3 + 478, ctzudodo, 129.3, 243.4 , 0 );

setEffMoveKey( spep_1 -3 + 480, ctzudodo, 121.8, 227.4 , 0 );

setEffMoveKey( spep_1 -3 + 482, ctzudodo, 138.1, 243 , 0 );

setEffMoveKey( spep_1 -3 + 484, ctzudodo, 125.7, 231.1 , 0 );

setEffMoveKey( spep_1 -3 + 486, ctzudodo, 121.4, 248.5 , 0 );

setEffMoveKey( spep_1 -3 + 488, ctzudodo, 127.6, 227.6 , 0 );

setEffMoveKey( spep_1 -3 + 490, ctzudodo, 134.4, 247 , 0 );

setEffMoveKey( spep_1 -3 + 492, ctzudodo, 123.8, 230.5 , 0 );

setEffMoveKey( spep_1 -3 + 494, ctzudodo, 140.2, 240.4 , 0 );

setEffMoveKey( spep_1 -3 + 496, ctzudodo, 120.5, 232.9 , 0 );

setEffMoveKey( spep_1 -3 + 498, ctzudodo, 131.3, 250.3 , 0 );

setEffMoveKey( spep_1 -3 + 500, ctzudodo, 122.5, 236 , 0 );

setEffMoveKey( spep_1 -3 + 502, ctzudodo, 133, 248.6 , 0 );

setEffMoveKey( spep_1 -3 + 504, ctzudodo, 127.6, 235.4 , 0 );

setEffMoveKey( spep_1 -3 + 506, ctzudodo, 135.7, 249.9 , 0 );

setEffMoveKey( spep_1 -3 + 508, ctzudodo, 122.6, 242.1 , 0 );

setEffMoveKey( spep_1 -3 + 510, ctzudodo, 139.7, 243.8 , 0 );

setEffMoveKey( spep_1 -3 + 512, ctzudodo, 122.2, 235.7 , 0 );

setEffMoveKey( spep_1 -3 + 514, ctzudodo, 134.1, 252.2 , 0 );

setEffMoveKey( spep_1 -3 + 516, ctzudodo, 132.3, 236.6 , 0 );

setEffMoveKey( spep_1 -3 + 518, ctzudodo, 139, 250.3 , 0 );

setEffMoveKey( spep_1 -3 + 519, ctzudodo, 139, 250.3 , 0 );



setEffScaleKey( spep_1 -3 + 426, ctzudodo, 2.91, 2.91 );

setEffScaleKey( spep_1 -3 + 428, ctzudodo, 2.91, 2.91 );

setEffScaleKey( spep_1 -3 + 430, ctzudodo, 2.92, 2.92 );

setEffScaleKey( spep_1 -3 + 432, ctzudodo, 2.92, 2.92 );

setEffScaleKey( spep_1 -3 + 434, ctzudodo, 2.93, 2.93 );

setEffScaleKey( spep_1 -3 + 436, ctzudodo, 2.93, 2.93 );

setEffScaleKey( spep_1 -3 + 438, ctzudodo, 2.94, 2.94 );

setEffScaleKey( spep_1 -3 + 442, ctzudodo, 2.94, 2.94 );

setEffScaleKey( spep_1 -3 + 444, ctzudodo, 2.95, 2.95 );

setEffScaleKey( spep_1 -3 + 446, ctzudodo, 2.95, 2.95 );

setEffScaleKey( spep_1 -3 + 448, ctzudodo, 2.96, 2.96 );

setEffScaleKey( spep_1 -3 + 450, ctzudodo, 2.96, 2.96 );

setEffScaleKey( spep_1 -3 + 452, ctzudodo, 2.97, 2.97 );

setEffScaleKey( spep_1 -3 + 454, ctzudodo, 2.97, 2.97 );

setEffScaleKey( spep_1 -3 + 456, ctzudodo, 2.98, 2.98 );

setEffScaleKey( spep_1 -3 + 458, ctzudodo, 2.98, 2.98 );

setEffScaleKey( spep_1 -3 + 460, ctzudodo, 2.99, 2.99 );

setEffScaleKey( spep_1 -3 + 462, ctzudodo, 2.99, 2.99 );

setEffScaleKey( spep_1 -3 + 464, ctzudodo, 3, 3 );

setEffScaleKey( spep_1 -3 + 466, ctzudodo, 3, 3 );

setEffScaleKey( spep_1 -3 + 468, ctzudodo, 3.01, 3.01 );

setEffScaleKey( spep_1 -3 + 470, ctzudodo, 3.01, 3.01 );

setEffScaleKey( spep_1 -3 + 472, ctzudodo, 3.02, 3.02 );

setEffScaleKey( spep_1 -3 + 474, ctzudodo, 3.02, 3.02 );

setEffScaleKey( spep_1 -3 + 476, ctzudodo, 3.03, 3.03 );

setEffScaleKey( spep_1 -3 + 478, ctzudodo, 3.03, 3.03 );

setEffScaleKey( spep_1 -3 + 480, ctzudodo, 3.04, 3.04 );

setEffScaleKey( spep_1 -3 + 482, ctzudodo, 3.04, 3.04 );

setEffScaleKey( spep_1 -3 + 484, ctzudodo, 3.05, 3.05 );

setEffScaleKey( spep_1 -3 + 486, ctzudodo, 3.05, 3.05 );

setEffScaleKey( spep_1 -3 + 488, ctzudodo, 3.06, 3.06 );

setEffScaleKey( spep_1 -3 + 490, ctzudodo, 3.06, 3.06 );

setEffScaleKey( spep_1 -3 + 492, ctzudodo, 3.07, 3.07 );

setEffScaleKey( spep_1 -3 + 494, ctzudodo, 3.07, 3.07 );

setEffScaleKey( spep_1 -3 + 496, ctzudodo, 3.08, 3.08 );

setEffScaleKey( spep_1 -3 + 498, ctzudodo, 3.08, 3.08 );

setEffScaleKey( spep_1 -3 + 500, ctzudodo, 3.09, 3.09 );

setEffScaleKey( spep_1 -3 + 502, ctzudodo, 3.09, 3.09 );

setEffScaleKey( spep_1 -3 + 504, ctzudodo, 3.1, 3.1 );

setEffScaleKey( spep_1 -3 + 506, ctzudodo, 3.1, 3.1 );

setEffScaleKey( spep_1 -3 + 508, ctzudodo, 3.11, 3.11 );

setEffScaleKey( spep_1 -3 + 510, ctzudodo, 3.11, 3.11 );

setEffScaleKey( spep_1 -3 + 512, ctzudodo, 3.12, 3.12 );

setEffScaleKey( spep_1 -3 + 514, ctzudodo, 3.12, 3.12 );

setEffScaleKey( spep_1 -3 + 516, ctzudodo, 3.13, 3.13 );

setEffScaleKey( spep_1 -3 + 518, ctzudodo, 3.13, 3.13 );

setEffScaleKey( spep_1 -3 + 519, ctzudodo, 3.14, 3.14 );



setEffRotateKey( spep_1 -3 + 426, ctzudodo, 63.6 );

setEffRotateKey( spep_1 -3 + 519, ctzudodo, 63.6 );



setEffAlphaKey( spep_1 -3 + 426, ctzudodo, 255 );

setEffAlphaKey( spep_1 -3 + 519, ctzudodo, 255 );



--SE

--気弾発射

SE031 = playSeVer2( spep_1 + 348, 1145, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_1 + 348, SE031, 84 );

SE032 = playSeVer2( spep_1 + 348, 1357, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_1 + 348, SE032, 150 );

setPitch( spep_1 + 348, SE032, -200 );

setTimeStretch( SE032, 0.87, 30, 4 );



--連続気弾

SE033 = playSeVer2( spep_1 + 376, 1358, "",spep_1 + 398, 0, 8, -1);

SE034 = playSeVer2( spep_1 + 385, 1358, "",spep_1 + 407, 0, 8, -1);

SE035 = playSeVer2( spep_1 + 393, 1358, "",spep_1 + 415, 0, 8, -1);

SE036 = playSeVer2( spep_1 + 401, 1358, "",spep_1 + 423, 0, 8, -1);

SE037 = playSeVer2( spep_1 + 410, 1358, "",spep_1 + 432, 0, 8, -1);

SE038 = playSeVer2( spep_1 + 415, 1024, "",spep_1 + 516 + 17, 0, 42, -1);

setSeVolumeByWorkId( spep_1 + 415, SE038, 79 );

SE039 = playSeVer2( spep_1 + 419, 1358, "",spep_1 + 441, 0, 8, -1);

SE040 = playSeVer2( spep_1 + 427, 1358, "",spep_1 + 449, 0, 8, -1);

SE041 = playSeVer2( spep_1 + 427, 1159, "",spep_1 + 516 + 148, 0, 76, -1);

setSeVolumeByWorkId( spep_1 + 427, SE041, 72 );

SE042 = playSeVer2( spep_1 + 435, 1358, "",spep_1 + 457, 0, 8, -1);

SE043 = playSeVer2( spep_1 + 444, 1358, "",spep_1 + 466, 0, 8, -1);

SE044 = playSeVer2( spep_1 + 449, 1023, "",spep_1 + 516 + 31, 0, 47, -1);

setSeVolumeByWorkId( spep_1 + 449, SE044, 77 );

SE045 = playSeVer2( spep_1 + 454, 1358, "",spep_1 + 476, 0, 8, -1);

SE046 = playSeVer2( spep_1 + 462, 1358, "",spep_1 + 484, 0, 8, -1);

SE047 = playSeVer2( spep_1 + 470, 1358, "",spep_1 + 492, 0, 8, -1);

SE048 = playSeVer2( spep_1 + 479, 1358, "",spep_1 + 501, 0, 8, -1);

setSeVolumeByWorkId( spep_1 + 479, SE048, 98 );

SE049 = playSeVer2( spep_1 + 488, 1358, "",spep_1 + 510, 0, 8, -1);

setSeVolumeByWorkId( spep_1 + 488, SE049, 81 );

SE050 = playSeVer2( spep_1 + 496, 1358, "",spep_1 + 516 + 2, 0, 8, -1);

setSeVolumeByWorkId( spep_1 + 496, SE050, 79 );



--ボイス

--だだだだ…！！(気弾連射)

playVoice( spep_1 + 350, 362 );

setVoiceVolume( spep_1 + 350, 362, 100 );



-- ** 黒背景 ** --

entryFadeBg( spep_1 + 0, 0, 518, 0, 0, 0, 0, 255);       -- ベース暗め　背景



--次の準備

spep_2=spep_1+516;





------------------------------------------------------

-- 斜め_突進

------------------------------------------------------

--spep_2=0;

-- ** エフェクト等 ** --

finish = entryEffect( spep_2 + 0, SP_03, 0x100, -1, 0, 0, 0 ); 

setEffMoveKey( spep_2 + 0, finish, 0, 0, 0 );

setEffMoveKey( spep_2 + 440, finish, 0, 0, 0 );

setEffScaleKey( spep_2 + 0, finish, 1.0, 1.0 );

setEffScaleKey( spep_2 + 440, finish, 1.0, 1.0 );

setEffRotateKey( spep_2 + 0, finish, 0 );

setEffRotateKey( spep_2 + 440, finish, 0 );

setEffAlphaKey( spep_2 + 0, finish, 255 );

setEffAlphaKey( spep_2 + 440, finish, 255 );



--SE

--気弾溜める

SE051 = playSeVer2( spep_2 + 16, 1334, "",spep_2 + 126, 0, 60, -1);

SE052 = playSeVer2( spep_2 + 16, 1313, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 16, SE052, 70 );

SE053 = playSeVer2( spep_2 + 16, 1289, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 16, SE053, 81 );



--気弾発射

SE054 = playSeVer2( spep_2 + 122, 1338, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 122, SE054, 82 );

setPitch( spep_2 + 122, SE054, -100 );

setTimeStretch( SE054, 0.93, 30, 4 );

SE055 = playSeVer2( spep_2 + 122, 1357, "",spep_2 + 186, 0, 42, -1);

setPitch( spep_2 + 122, SE055, 600 );

setTimeStretch( SE055, 1.4, 30, 4 );

SE056 = playSeVer2( spep_2 + 122, 1027, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 122, SE056, 61 );

SE057 = playSeVer2( spep_2 + 122, 1312, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 122, SE057, 108 );



--気弾飛んでいく

SE058 = playSeVer2( spep_2 + 138, 1304, "",spep_2 + 244, 0, 32, -1);

SE059 = playSeVer2( spep_2 + 159, 1202, "",spep_2 + 229, 0, 25, -1);

setSeVolumeByWorkId( spep_2 + 159, SE059, 89 );

SE060 = playSeVer2( spep_2 + 167, 1179, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 167, SE060, 114 );

setPitch( spep_2 + 167, SE060, 600 );

setTimeStretch( SE060, 1.4, 30, 4 );

SE061 = playSeVer2( spep_2 + 167, 1277, "",spep_2 + 220, 0, 32, -1);

setSeVolumeByWorkId( spep_2 + 167, SE061, 143 );



--爆発

SE062 = playSeVer2( spep_2 + 209, 1061, "", 0, 0, 0, -1);

SE063 = playSeVer2( spep_2 + 213, 1023, "", 0, 0, 0, -1);

SE064 = playSeVer2( spep_2 + 213, 1024, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 213, SE064, 86 );



--ラスト爆発

SE065 = playSeVer2( spep_2 + 265, 1069, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 265, SE065, 87 );

SE066 = playSeVer2( spep_2 + 274, 1258, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 274, SE066, 58 );

SE067 = playSeVer2( spep_2 + 284, 1067, "", 0, 0, 0, -1);

SE068 = playSeVer2( spep_2 + 287, 1159, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_2 + 287, SE068, 97 );



--ボイス

--たぁあーー！！(スターダストブレイカー)

playVoice( spep_2 + 93, 363 );

setVoiceVolume( spep_2 + 93, 363, 100 );



-- ** 黒背景 ** --

entryFadeBg( spep_2 + 0, 0, 442, 0, 0, 0, 0, 255);       -- ベース暗め　背景



--終わり

dealDamage( spep_2 + 292);

endPhase( spep_2 + 430 );

else end