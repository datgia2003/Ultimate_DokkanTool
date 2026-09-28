--1034030:LR_超サイヤ人孫悟空_アクティブターゲット集中：怒りの戦士孫悟空

--battle_301361

--tf0088



fcolor_r = 245;

fcolor_g = 245;

fcolor_b = 245;



--エフェクト(共通)

SP_01 = 3315; --アクティブターゲット集中 ef_001



------------------------------------------------------

-- テンプレ構文

------------------------------------------------------



setVisibleUI( 0, 0);



setDisp( 0, 0, 0);

setDisp( 0, 1, 0);



changeAnime( 0, 0, 0);

changeAnime( 0, 1, 100);



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



--setAlphaKey( 0, 1, 255 );







ENABLE_AUTO_TIME_STRETCH(0.9);



if (_IS_PLAYER_SIDE_ == 1) then



------------------------------------------------------------------------------------------------------------

-- 開始

------------------------------------------------------------------------------------------------------------



spep_0 = 0;



setupMovie(0, SP_01, 0, 1);



------------------------------------------------------

-- アクティブターゲット集中

------------------------------------------------------

MAX_FRAME_0 = 656;



-- ** エフェクト等 ** --

start_f = entryEffect( spep_0 + 0, SP_01, 0x100, -1, 0, 0, 0); -- アクティブターゲット集中(ef_001)

setEffMoveKey( spep_0 + 0, start_f, 0, 0 , 0);

setEffMoveKey( spep_0 + MAX_FRAME_0, start_f, 0, 0 , 0);

setEffScaleKey( spep_0 + 0, start_f, 1.0, 1.0);

setEffScaleKey( spep_0 + MAX_FRAME_0, start_f, 1.0, 1.0);

setEffRotateKey( spep_0 + 0, start_f, 0);

setEffRotateKey( spep_0 + MAX_FRAME_0, start_f, 0);

setEffAlphaKey( spep_0 + 0, start_f, 255);

setEffAlphaKey( spep_0 + MAX_FRAME_0, start_f, 255);



-- ** 黒背景 ** --

entryFadeBg( spep_0 + 0, 0, MAX_FRAME_0 + 2, 0, 0, 0, 0, 255 );





--------------------------------------

-- 音

--------------------------------------

-- ** SE ** --

--煙たつ

SE001 = playSeVer2( spep_0 + 0, 1229, "", 0, 0, 0, -1);

SE002 = playSeVer2( spep_0 + 0, 1159, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 0, SE002, 48 );

--環境音

SE003 = playSeVer2( spep_0 + 0, 1269, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 0, SE003, 25 );

--煙たつ

SE004 = playSeVer2( spep_0 + 120, 1168, "", 0, 74, 0, -1);

setSeVolumeByWorkId( spep_0 + 120, SE004, 35 );

--セリフカットイン

SE005 = playSeVer2( spep_0 + 445, 1018, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 445, SE005, 63 );





-- ** ボイス ** --

--「おまえは もうあやまってもゆるさないぞ…」

playVoice( spep_0 + 438, 1238 );

setVoiceVolume( spep_0 + 438, 1238, 122 );





-----------------------------

-- 終了

-----------------------------

endPhase( spep_0 + MAX_FRAME_0); -- 656f



end