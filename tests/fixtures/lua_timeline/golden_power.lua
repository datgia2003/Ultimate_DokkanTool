--1031720:LR_ゴールデンフリーザ+ゴジータ_合流演出

--sp_effect_b4_00393

--pse0091



fcolor_r = 245;

fcolor_g = 245;

fcolor_b = 245;



-- 味方側

SP_01 = 164063;  -- 合流演出 ef_001



------------------------------------------------------

-- テンプレ構文

------------------------------------------------------



setVisibleUI( 0, 0 );



changeAnime( 0, 0, 0 );

changeAnime( 0, 1, 100 );

setDisp( 0, 0, 0 );

setDisp( 0, 1, 0 );



setMoveKey(   0,   0,    0, -5000,   0 );

setMoveKey(   1,   0,    0, -5000,   0 );

setMoveKey(   2,   0,    0, -5000,   0 );

setMoveKey(   3,   0,    0, -5000,   0 );

setMoveKey(   4,   0,    0, -5000,   0 );

setMoveKey(   5,   0,    0, -5000,   0 );

setMoveKey(   6,   0,    0, -5000,   0 );

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



setMoveKey(   0,   1,    0, -5000,   0 );

setMoveKey(   1,   1,    0, -5000,   0 );

setMoveKey(   2,   1,    0, -5000,   0 );

setMoveKey(   3,   1,    0, -5000,   0 );

setMoveKey(   4,   1,    0, -5000,   0 );

setMoveKey(   5,   1,    0, -5000,   0 );

setMoveKey(   6,   1,    0, -5000,   0 );

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



ENABLE_AUTO_TIME_STRETCH(0.9);



if (_IS_PLAYER_SIDE_ == 1) then



------------------------------------------------------

-- 合流演出

------------------------------------------------------

spep_0 = 0;



MAX_FRAME_0 = 782;



-- ** エフェクト等 ** --

base_0 = entryEffect( spep_0 + 0, SP_01, 0x80, -1, 0, 0, 0); -- 合流演出（ef_001）

setEffMoveKey( 0, base_0, 0, 0 , 0);

setEffMoveKey( 782, base_0, 0, 0 , 0);

setEffScaleKey( 0, base_0, 1.0, 1.0);

setEffScaleKey( 782, base_0, 1.0, 1.0);

setEffRotateKey( 0, base_0, 0);

setEffRotateKey( 782, base_0, 0);

setEffAlphaKey( 0, base_0, 255);

setEffAlphaKey( 782, base_0, 255);



-- ** 黒背景 ** --

entryFadeBg( 0, 0, MAX_FRAME_0 + 2, 0, 0, 0, 0, 255 );



-- ** 音 ** --



--環境音

SE001 = playSeVer2( spep_0 + 0, 1269, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 0, SE001, 25 );

--力む

SE002 = playSeVer2( spep_0 + 0, 1330, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 0, SE002, 50 );

--瞬間移動

SE003 = playSeVer2( spep_0 + 130, 1499, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 130, SE003, 72 );

SE004 = playSeVer2( spep_0 + 130, 1109, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 130, SE004, 126 );

--セリフカットイン

SE005 = playSeVer2( spep_0 + 204, 1018, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 204, SE005, 63 );

--帯なびく

SE006 = playSeVer2( spep_0 + 350, 1332, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 350, SE006, 65 );

SE007 = playSeVer2( spep_0 + 402, 1331, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 402, SE007, 81 );

SE008 = playSeVer2( spep_0 + 456, 1332, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 456, SE008, 53 );

--空気音

SE009 = playSeVer2( spep_0 + 498, 1175, "", 0, 0, 0, -1);

setSeVolumeByWorkId( 498, SE009, 32 );



-- ** ボイス ** --



--「なんですか あなた！？」

playVoice( 200, 1063 );

setVoiceVolume( 200, 1063, 112 );

--「ふん…オレはゴジータ」

playVoice( 328, 1064 );

setVoiceVolume( 328, 1064, 112 );

--「悟空とベジータが合体したんだよ」

playVoice( 526, 1065 );

setVoiceVolume( 526, 1065, 112 );



-- ** 終わり ** --

endPhase( spep_0 + MAX_FRAME_0); --782



else end

